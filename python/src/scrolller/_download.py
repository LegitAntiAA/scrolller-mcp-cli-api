"""Media downloads (CONTRACT.md §7).

- Source choice: ONLY post-level ``mediaSources[]`` entries are media files —
  videos are the MP4/WEBM entries (largest area wins), images the largest
  entry overall. ``fullLengthSource``/``gfycatSource``/``redgifsSource`` are
  reference PAGE URLs (gfycat/redgifs web pages — T1-RESEARCH-FULL.md §3/§5),
  never media, and are ignored here. The literal string ``"undefined"``
  (backend artifact, RESEARCH.md §4) is treated as absent everywhere.
- Filename: ``<postId>-<slug or subreddit>-<WxH>.<ext>``; the file is created
  with an exclusive open (``O_CREAT|O_EXCL``) so concurrent downloads never
  overwrite each other; collisions get a numeric suffix. Existing files are
  never overwritten.
- Progress via a ``progress_callback(DownloadProgress)`` callback; a raising
  callback still triggers partial-file cleanup.
- An audio sidecar ``<name>.audio.<ext>`` is saved when the API exposes an
  audio source. Currently none does (audio lives inside the mp4/webm —
  T1-RESEARCH-FULL.md §5), so the path is dormant but implemented per §7.
"""

from __future__ import annotations

import concurrent.futures
import contextlib
import os
import re
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

import httpx

from scrolller._errors import DownloadError, NotFoundError
from scrolller._types import DEFAULT_TIMEOUT_MS, DownloadProgress, DownloadResult

_CHUNK_SIZE = 64 * 1024
_URL_DIMENSIONS = re.compile(r"(\d{1,5})x(\d{1,5})")
_FILENAME_INVALID = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_WHITESPACE = re.compile(r"\s+")

_VIDEO_TYPES = {"MP4", "WEBM"}

_TYPE_EXT = {
    "WEBP": "webp",
    "JPEG": "jpg",
    "JPG": "jpg",
    "PNG": "png",
    "GIF": "gif",
    "MP4": "mp4",
    "WEBM": "webm",
    "M3U8": "m3u8",
}

ProgressCallback = Callable[[DownloadProgress], None]


def _as_source(value: Any) -> Optional[Dict[str, Any]]:
    """Normalize a media source entry; scalar URLs become ``{"url": ...}``.

    The literal string ``"undefined"`` (backend artifact, RESEARCH.md §4) is
    treated as absent so callers fall back to other sources.
    """
    if isinstance(value, str) and value and value != "undefined":
        return {"url": value}
    if isinstance(value, dict) and value.get("url") and value.get("url") != "undefined":
        return value
    return None


def _area(source: Dict[str, Any]) -> int:
    """width*height; missing or non-numeric values count as 0."""

    def dim(value: Any) -> int:
        try:
            return int(value) if value is not None else 0
        except (TypeError, ValueError):
            return 0

    return dim(source.get("width")) * dim(source.get("height"))


def best_media_source(post: Dict[str, Any]) -> Dict[str, Any]:
    """Pick the download source for a post (CONTRACT.md §7).

    Only post-level ``mediaSources[]`` entries are media files: for videos
    the MP4/WEBM entries (largest area wins), for images the largest entry
    overall. ``fullLengthSource``/``gfycatSource``/``redgifsSource`` are
    reference page URLs (gfycat/redgifs web pages — T1-RESEARCH-FULL.md
    §3/§5), never media, and are ignored here.
    """
    candidates = []
    for raw in post.get("mediaSources") or []:
        normalized = _as_source(raw)
        if normalized is not None:
            candidates.append(normalized)
    if not candidates:
        raise DownloadError("post has no usable media sources")
    video_entries = [
        source for source in candidates if str(source.get("type") or "").upper() in _VIDEO_TYPES
    ]
    return max(video_entries or candidates, key=_area)


def _audio_source(post: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Audio sidecar source, when the API exposes one.

    T1-RESEARCH-FULL.md §5 verified there is NO separate audio URL (audio
    lives inside the mp4/webm file); this path only triggers if a future
    field like ``audioSource`` appears, keeping CONTRACT.md §7 implemented.
    """
    return _as_source(post.get("audioSource"))


def _extension(source: Dict[str, Any], fallback: str) -> str:
    url = str(source.get("url") or "")
    path = url.split("?", 1)[0].split("#", 1)[0]
    last_segment = path.rsplit("/", 1)[-1]
    if "." in last_segment:
        ext = last_segment.rsplit(".", 1)[-1].lower()
        if ext.isalnum() and len(ext) <= 5:
            return ext
    type_hint = str(source.get("type") or "").upper()
    return _TYPE_EXT.get(type_hint, fallback)


def _dimensions(source: Dict[str, Any]) -> Tuple[int, int]:
    try:
        width = int(source.get("width")) if source.get("width") is not None else 0
        height = int(source.get("height")) if source.get("height") is not None else 0
    except (TypeError, ValueError):
        width = height = 0
    if not (width and height):
        # Original URLs embed the size: ...-<reddit-id>-WxH.ext (RESEARCH.md §4).
        path = str(source.get("url") or "").split("?", 1)[0]
        matches = _URL_DIMENSIONS.findall(path)
        if matches:
            width, height = int(matches[-1][0]), int(matches[-1][1])
    return width, height


def _slug(post: Dict[str, Any]) -> str:
    url = str(post.get("url") or "")
    segment = url.split("?", 1)[0].rstrip("/").rsplit("/", 1)[-1] if url else ""
    candidate = segment or str(post.get("subredditTitle") or post.get("subredditUrl") or "")
    cleaned = _FILENAME_INVALID.sub("-", candidate.strip())
    cleaned = _WHITESPACE.sub("-", cleaned).strip("-. ")
    return cleaned[:80] or "post"


def _open_exclusive(target_dir: Path, stem: str, ext: str) -> Tuple[Path, Any]:
    """Open ``<stem>.<ext>`` (then ``<stem>-1.<ext>``, ...) with ``O_CREAT|O_EXCL``.

    Exclusive creation closes the pick-then-write race: two concurrent
    downloads can never end up writing the same file.
    """
    candidate = target_dir / f"{stem}.{ext}"
    index = 1
    while True:
        try:
            return candidate, candidate.open("xb")
        except FileExistsError:
            candidate = target_dir / f"{stem}-{index}.{ext}"
            index += 1


def _stream_to_file(
    client: httpx.Client,
    url: str,
    target_dir: Path,
    stem: str,
    ext: str,
    *,
    post_id: str,
    progress_callback: Optional[ProgressCallback],
) -> Path:
    """Download ``url`` into a uniquely created file in ``target_dir``.

    Requires a 2xx response (3xx must be resolved by ``follow_redirects``).
    Any failure — including a raising ``progress_callback`` — removes the
    partial file before the exception propagates.
    """
    path: Optional[Path] = None
    try:
        try:
            path, fh = _open_exclusive(target_dir, stem, ext)
            try:
                with client.stream("GET", url) as response:
                    if response.status_code == 404:
                        raise NotFoundError(f"media not found (HTTP 404): {url}")
                    if not 200 <= response.status_code < 300:
                        raise DownloadError(f"HTTP {response.status_code} fetching {url}")
                    length_header = response.headers.get("content-length")
                    total = (
                        int(length_header) if length_header and length_header.isdigit() else None
                    )
                    done = 0
                    for chunk in response.iter_bytes(chunk_size=_CHUNK_SIZE):
                        fh.write(chunk)
                        done += len(chunk)
                        if progress_callback is not None:
                            progress_callback(
                                DownloadProgress(
                                    post_id=post_id,
                                    url=url,
                                    bytes_done=done,
                                    bytes_total=total,
                                    path=str(path),
                                    done=False,
                                )
                            )
            finally:
                fh.close()
            if progress_callback is not None:
                progress_callback(
                    DownloadProgress(
                        post_id=post_id,
                        url=url,
                        bytes_done=done,
                        bytes_total=total,
                        path=str(path),
                        done=True,
                    )
                )
            return path
        except httpx.HTTPError as exc:
            raise DownloadError(f"download failed for {url}: {exc}") from exc
        except OSError as exc:
            raise DownloadError(f"cannot write into {target_dir}: {exc}") from exc
    except BaseException:
        # Never leave a partial file behind — also covers callback exceptions.
        if path is not None:
            with contextlib.suppress(OSError):
                path.unlink(missing_ok=True)
        raise


def _post_id(post: Dict[str, Any]) -> str:
    return str(post.get("id") or "post")


def download_media(
    post: Dict[str, Any],
    target_dir: Union[str, "os.PathLike[str]"],
    *,
    progress_callback: Optional[ProgressCallback] = None,
    client: Optional[httpx.Client] = None,
    timeout_ms: int = DEFAULT_TIMEOUT_MS,
) -> Path:
    """Download a post's best media source into ``target_dir``; return the path.

    ``client`` lets callers share a pre-configured ``httpx.Client`` (the
    library passes the client's own so the proxy applies to downloads too).
    ``post`` must be a post object (mapping); URL/id refs are resolved by the
    operation methods in a later phase.
    """
    if isinstance(post, str):
        raise DownloadError(
            "download_media needs a post object; URL/id refs will be resolved by the "
            "operation methods"
        )
    if not isinstance(post, dict):
        raise DownloadError(f"post must be a mapping, got {type(post).__name__}")

    source = best_media_source(post)
    audio = _audio_source(post)
    post_id = _post_id(post)
    width, height = _dimensions(source)
    stem = f"{post_id}-{_slug(post)}-{width}x{height}"

    target = Path(target_dir).expanduser()
    try:
        target.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise DownloadError(f"cannot create download directory {target}: {exc}") from exc

    owned_client = client is None
    if owned_client:
        client = httpx.Client(timeout=httpx.Timeout(timeout_ms / 1000.0), follow_redirects=True)
    try:
        main_path = _stream_to_file(
            client,
            str(source["url"]),
            target,
            stem,
            _extension(source, "jpg"),
            post_id=post_id,
            progress_callback=progress_callback,
        )
        if audio is not None:
            _stream_to_file(
                client,
                str(audio["url"]),
                target,
                f"{stem}.audio",
                _extension(audio, "mp3"),
                post_id=post_id,
                progress_callback=progress_callback,
            )
    finally:
        if owned_client:
            client.close()
    return main_path


def download_many(
    posts: List[Dict[str, Any]],
    target_dir: Union[str, "os.PathLike[str]"],
    *,
    concurrency: int = 4,
    progress_callback: Optional[ProgressCallback] = None,
    client: Optional[httpx.Client] = None,
    timeout_ms: int = DEFAULT_TIMEOUT_MS,
) -> List[DownloadResult]:
    """Download many posts concurrently (thread pool); one result per post.

    ``progress_callback`` fires from worker threads and must be thread-safe.
    Failures are reported per item (``DownloadResult.error``), never lost.
    """
    posts = list(posts)
    results: List[Optional[DownloadResult]] = [None] * len(posts)
    if not posts:
        return []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, int(concurrency))) as pool:
        futures = {
            pool.submit(
                download_media,
                post,
                target_dir,
                progress_callback=progress_callback,
                client=client,
                timeout_ms=timeout_ms,
            ): index
            for index, post in enumerate(posts)
        }
        for future in concurrent.futures.as_completed(futures):
            index = futures[future]
            post = posts[index]
            fallback_id = _post_id(post) if isinstance(post, dict) else "post"
            try:
                path = future.result()
                results[index] = DownloadResult(post_id=fallback_id, path=str(path))
            except Exception as exc:
                results[index] = DownloadResult(post_id=fallback_id, error=str(exc))
    return [
        result or DownloadResult(post_id="post", error="download did not complete")
        for result in results
    ]

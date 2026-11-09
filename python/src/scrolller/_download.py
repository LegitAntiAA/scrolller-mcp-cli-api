"""Media downloads (CONTRACT.md §7).

- Source choice: videos prefer ``fullLengthSource``; otherwise the largest
  ``mediaSources`` entry by width*height (list is small->large per RESEARCH.md §4).
- Filename: ``<postId>-<slug or subreddit>-<WxH>.<ext>``; collisions get a
  numeric suffix; existing files are never overwritten.
- Progress via an ``on_progress(DownloadProgress)`` callback.
- An audio sidecar is saved next to the media file as ``<name>.audio.<ext>``
  when the API exposes an audio source. NOTE: the query verified in
  RESEARCH.md does not surface an audio URL field, so sidecars are driven by
  an ``audioSource`` entry on the post when the server includes one; the
  ffmpeg merge step belongs to the operation-methods phase.
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


def best_media_source(post: Dict[str, Any]) -> Dict[str, Any]:
    """Pick the download source for a post (CONTRACT.md §7).

    Videos prefer ``fullLengthSource`` (the literal string ``"undefined"`` is
    ignored); otherwise the largest ``mediaSources`` entry by area — which
    per RESEARCH.md §4 includes MP4/WEBM video entries directly.
    """
    source = _as_source(post.get("fullLengthSource"))
    if source is not None:
        return source
    candidates = []
    for raw in post.get("mediaSources") or []:
        normalized = _as_source(raw)
        if normalized is not None:
            candidates.append(normalized)
    if not candidates:
        raise DownloadError("post has no usable media sources")
    return max(
        candidates,
        key=lambda s: int(s.get("width") or 0) * int(s.get("height") or 0),
    )


def _audio_source(post: Dict[str, Any]) -> Optional[Dict[str, Any]]:
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


def _resolve_path(target_dir: Path, stem: str, ext: str) -> Path:
    """First non-existing ``<stem>.<ext>``, ``<stem>-1.<ext>``, ... (no overwrite)."""
    candidate = target_dir / f"{stem}.{ext}"
    index = 1
    while candidate.exists():
        candidate = target_dir / f"{stem}-{index}.{ext}"
        index += 1
    return candidate


def _stream_to_file(
    client: httpx.Client,
    url: str,
    path: Path,
    *,
    post_id: str,
    on_progress: Optional[ProgressCallback],
) -> None:
    """Stream ``url`` to ``path``, emitting DownloadProgress events."""
    try:
        with client.stream("GET", url) as response:
            if response.status_code == 404:
                raise NotFoundError(f"media not found (HTTP 404): {url}")
            if response.status_code >= 400:
                raise DownloadError(f"HTTP {response.status_code} fetching {url}")
            length_header = response.headers.get("content-length")
            total = int(length_header) if length_header and length_header.isdigit() else None
            done = 0
            with path.open("wb") as fh:
                for chunk in response.iter_bytes(chunk_size=_CHUNK_SIZE):
                    fh.write(chunk)
                    done += len(chunk)
                    if on_progress is not None:
                        on_progress(
                            DownloadProgress(
                                post_id=post_id,
                                url=url,
                                bytes_done=done,
                                bytes_total=total,
                                path=str(path),
                                done=False,
                            )
                        )
        if on_progress is not None:
            on_progress(
                DownloadProgress(
                    post_id=post_id,
                    url=url,
                    bytes_done=done,
                    bytes_total=total,
                    path=str(path),
                    done=True,
                )
            )
    except (NotFoundError, DownloadError):
        # Never leave a partial file behind.
        with contextlib.suppress(OSError):
            path.unlink(missing_ok=True)
        raise
    except httpx.HTTPError as exc:
        with contextlib.suppress(OSError):
            path.unlink(missing_ok=True)
        raise DownloadError(f"download failed for {url}: {exc}") from exc
    except OSError as exc:
        with contextlib.suppress(OSError):
            path.unlink(missing_ok=True)
        raise DownloadError(f"cannot write {path}: {exc}") from exc


def _post_id(post: Dict[str, Any]) -> str:
    return str(post.get("id") or "post")


def download_media(
    post: Dict[str, Any],
    target_dir: Union[str, "os.PathLike[str]"],
    *,
    on_progress: Optional[ProgressCallback] = None,
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

    main_path = _resolve_path(target, stem, _extension(source, "jpg"))
    owned_client = client is None
    if owned_client:
        client = httpx.Client(timeout=httpx.Timeout(timeout_ms / 1000.0), follow_redirects=True)
    try:
        _stream_to_file(client, str(source["url"]), main_path, post_id=post_id, on_progress=on_progress)
        if audio is not None:
            audio_path = _resolve_path(target, f"{stem}.audio", _extension(audio, "mp3"))
            _stream_to_file(client, str(audio["url"]), audio_path, post_id=post_id, on_progress=on_progress)
    finally:
        if owned_client:
            client.close()
    return main_path


def download_many(
    posts: List[Dict[str, Any]],
    target_dir: Union[str, "os.PathLike[str]"],
    *,
    concurrency: int = 4,
    on_progress: Optional[ProgressCallback] = None,
    client: Optional[httpx.Client] = None,
    timeout_ms: int = DEFAULT_TIMEOUT_MS,
) -> List[DownloadResult]:
    """Download many posts concurrently (thread pool); one result per post.

    ``on_progress`` fires from worker threads and must be thread-safe.
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
                on_progress=on_progress,
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

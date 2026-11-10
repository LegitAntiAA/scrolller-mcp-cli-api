"""Unit tests for download source choice, naming and streaming rules (no network)."""

import pytest

from scrolller._download import (
    _extension,
    _open_exclusive,
    _stream_to_file,
    best_media_source,
)
from scrolller._errors import DownloadError, NotFoundError, ScrolllerError
from scrolller._types import DownloadProgress


def _video_post():
    """Realistic video-post shape (T1-RESEARCH-FULL.md §3/§5).

    fullLengthSource/gfycatSource/redgifsSource are gfycat/redgifs PAGE URLs —
    never media. Videos come as MP4/WEBM entries in post-level mediaSources[]
    (atto.scrolller.com), thumbnails as WEBP (yocto/zepto hosts).
    """
    return {
        "id": 1,
        "subredditTitle": "sub",
        "url": "https://scrolller.com/r/sub/the-quick-brown-fox-6r5fise4vl",
        "fullLengthSource": "https://gfycat.com/bananaslug-the-quick-brown-fox",
        "gfycatSource": "undefined",
        "redgifsSource": "undefined",
        "mediaSources": [
            {
                "url": "https://images.scrolller.com/yocto/the-quick-brown-fox-6r5fise4vl-480x360.webp",
                "width": 480,
                "height": 360,
                "type": "WEBP",
            },
            {
                "url": "https://images.scrolller.com/zepto/the-quick-brown-fox-6r5fise4vl-720x1280.webp",
                "width": 720,
                "height": 1280,
                "type": "WEBP",
            },
            {
                "url": "https://atto.scrolller.com/the-quick-brown-fox-jumps-over-the-lazy-dog-my-6r5fise4vl.webm",
                "width": 640,
                "height": 1136,
                "type": "WEBM",
            },
            {
                "url": "https://atto.scrolller.com/the-quick-brown-fox-jumps-over-the-lazy-dog-my-6r5fise4vl.mp4",
                "width": 720,
                "height": 1280,
                "type": "MP4",
            },
        ],
    }


def _image_post():
    return {
        "id": 2,
        "subredditTitle": "pics",
        "mediaSources": [
            {"url": "https://images.scrolller.com/nano/cute-fox-ctqgn16e9m-540x957.webp", "width": 540, "height": 957, "type": "WEBP"},
            {"url": "https://images.scrolller.com/zepto/cute-fox-ctqgn16e9m-1080x1440.webp", "width": 1080, "height": 1440, "type": "WEBP"},
            {"url": "https://images.scrolller.com/zepto/9a1b2c3d4e5f.jpg", "width": 1080, "height": 1440, "type": "JPEG"},
        ],
    }


# ------------------------------------------------------- F1: mediaSources only


def test_video_picks_largest_media_type_entry_from_media_sources():
    source = best_media_source(_video_post())
    assert source["type"] == "MP4"
    assert source["url"] == "https://atto.scrolller.com/the-quick-brown-fox-jumps-over-the-lazy-dog-my-6r5fise4vl.mp4"


def test_page_link_fields_are_never_used_as_media():
    # The gfycat PAGE URL in fullLengthSource must not win over mediaSources.
    source = best_media_source(_video_post())
    assert "gfycat.com" not in source["url"]
    # And with ONLY page-link fields (no mediaSources) there is no media at all.
    page_links_only = {
        "id": 3,
        "fullLengthSource": "https://gfycat.com/bananaslug-clip",
        "gfycatSource": "https://www.redgifs.com/watch/someclip",
        "redgifsSource": "undefined",
    }
    with pytest.raises(DownloadError):
        best_media_source(page_links_only)


def test_undefined_string_normalized_to_absent():
    post = {
        "id": 4,
        "fullLengthSource": "undefined",
        "gfycatSource": "undefined",
        "redgifsSource": "undefined",
        "mediaSources": [
            {"url": "https://images.scrolller.com/nano/small-100x100.webp", "width": 100, "height": 100, "type": "WEBP"},
            {"url": "https://images.scrolller.com/zepto/big-800x600.webp", "width": 800, "height": 600, "type": "WEBP"},
        ],
    }
    assert best_media_source(post)["url"] == "https://images.scrolller.com/zepto/big-800x600.webp"


def test_undefined_url_inside_dict_source_is_ignored():
    post = {
        "id": 5,
        "mediaSources": [
            {"url": "undefined", "width": 9999, "height": 9999, "type": "MP4"},
            {"url": "https://images.scrolller.com/zepto/real-300x200.jpg", "width": 300, "height": 200, "type": "JPEG"},
        ],
    }
    assert best_media_source(post)["url"] == "https://images.scrolller.com/zepto/real-300x200.jpg"


def test_largest_area_wins_for_images():
    source = best_media_source(_image_post())
    assert source["type"] == "WEBP"  # both 1080x1440 entries tie; first wins
    assert source["width"] == 1080


def test_no_sources_raises_download_error():
    with pytest.raises(DownloadError):
        best_media_source({"id": 6, "mediaSources": []})
    with pytest.raises(DownloadError):
        best_media_source({"id": 7, "fullLengthSource": "undefined"})


# ---------------------------------------------------- F17: non-numeric dims


def test_non_numeric_dimensions_treated_as_zero():
    post = {
        "id": 8,
        "mediaSources": [
            {"url": "https://h/broken.webp", "width": "abc", "height": None, "type": "WEBP"},
            {"url": "https://h/good-200x100.webp", "width": 200, "height": 100, "type": "WEBP"},
        ],
    }
    source = best_media_source(post)  # must not raise ValueError
    assert source["url"] == "https://h/good-200x100.webp"


# -------------------------------------------------------- naming helpers


def test_extension_from_url_and_type():
    assert _extension({"url": "https://atto.scrolller.com/clip.mp4?token=1"}, "jpg") == "mp4"
    assert _extension({"url": "https://h/noext", "type": "WEBP"}, "jpg") == "webp"
    assert _extension({"url": "https://h/noext"}, "jpg") == "jpg"


def test_open_exclusive_never_overwrites(tmp_path):
    # Exclusive creation: the name is claimed by the OS, so concurrent
    # downloads can never pick the same path (F6).
    path1, fh1 = _open_exclusive(tmp_path, "1-sub-720x1280", "mp4")
    assert path1.name == "1-sub-720x1280.mp4"
    path2, fh2 = _open_exclusive(tmp_path, "1-sub-720x1280", "mp4")
    assert path2.name == "1-sub-720x1280-1.mp4"
    fh1.close()
    fh2.close()


# ------------------------------------- streaming rules via a fake client (F5/F16)


class _FakeResponse:
    def __init__(self, status_code=200, chunks=(b"hello",), headers=None):
        self.status_code = status_code
        self._chunks = chunks
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def iter_bytes(self, chunk_size=None):
        yield from self._chunks


class _FakeClient:
    def __init__(self, response):
        self._response = response

    def stream(self, method, url):
        return self._response


def test_stream_requires_2xx_and_cleans_up(tmp_path):
    # 3xx with redirects un-followed must NOT be saved as the media file (F5).
    with pytest.raises(DownloadError):
        _stream_to_file(
            _FakeClient(_FakeResponse(status_code=302)),
            "https://h/clip.mp4",
            tmp_path,
            "9-clip-720x1280",
            "mp4",
            post_id="9",
            progress_callback=None,
        )
    assert list(tmp_path.iterdir()) == []

    with pytest.raises(DownloadError):
        _stream_to_file(
            _FakeClient(_FakeResponse(status_code=403)),
            "https://h/clip.mp4",
            tmp_path,
            "9-clip-720x1280",
            "mp4",
            post_id="9",
            progress_callback=None,
        )
    assert list(tmp_path.iterdir()) == []

    path = _stream_to_file(
        _FakeClient(_FakeResponse(status_code=200, chunks=(b"ab", b"cd"), headers={"content-length": "4"})),
        "https://atto.scrolller.com/clip.mp4",
        tmp_path,
        "9-clip-720x1280",
        "mp4",
        post_id="9",
        progress_callback=None,
    )
    assert path.read_bytes() == b"abcd"


def test_404_raises_not_found(tmp_path):
    with pytest.raises(NotFoundError):
        _stream_to_file(
            _FakeClient(_FakeResponse(status_code=404)),
            "https://h/gone.mp4",
            tmp_path,
            "9-gone-1x1",
            "mp4",
            post_id="9",
            progress_callback=None,
        )
    assert list(tmp_path.iterdir()) == []


def test_raising_callback_cleans_partial_file(tmp_path):
    events = []

    def bad_callback(progress):
        events.append(progress.bytes_done)
        if len(events) >= 2:  # explode after two chunks -> real partial file
            raise RuntimeError("callback exploded")

    with pytest.raises(RuntimeError):
        _stream_to_file(
            _FakeClient(_FakeResponse(status_code=200, chunks=(b"ab", b"cd", b"ef"))),
            "https://h/clip.mp4",
            tmp_path,
            "9-clip-720x1280",
            "mp4",
            post_id="9",
            progress_callback=bad_callback,
        )
    # Callback ran, then the partial file was removed before propagating (F16).
    assert events == [2, 4]
    assert list(tmp_path.iterdir()) == []


def test_stream_no_overwrite_on_successive_downloads(tmp_path):
    first = _stream_to_file(
        _FakeClient(_FakeResponse(chunks=(b"a",))),
        "https://h/clip.mp4",
        tmp_path,
        "9-clip-720x1280",
        "mp4",
        post_id="9",
        progress_callback=None,
    )
    second = _stream_to_file(
        _FakeClient(_FakeResponse(chunks=(b"b",))),
        "https://h/clip.mp4",
        tmp_path,
        "9-clip-720x1280",
        "mp4",
        post_id="9",
        progress_callback=None,
    )
    assert first.name == "9-clip-720x1280.mp4"
    assert second.name == "9-clip-720x1280-1.mp4"
    assert first.read_bytes() == b"a"  # never overwritten

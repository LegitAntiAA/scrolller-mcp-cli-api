"""Unit tests for download source choice and naming (no network)."""

from scrolller._download import (
    _extension,
    _resolve_path,
    best_media_source,
)
from scrolller._errors import DownloadError

import pytest


def test_full_length_source_preferred_for_videos():
    post = {
        "id": 1,
        "fullLengthSource": "https://zepto.scrolller.com/clip.mp4",
        "mediaSources": [
            {"url": "https://images.scrolller.com/a-100x100.webp", "width": 100, "height": 100, "type": "WEBP"},
            {"url": "https://zepto.scrolller.com/clip.mp4", "width": 1920, "height": 1080, "type": "MP4"},
        ],
    }
    assert best_media_source(post)["url"] == "https://zepto.scrolller.com/clip.mp4"


def test_undefined_string_normalized_to_absent():
    # RESEARCH.md §4: fullLengthSource/gfycatSource/redgifsSource can be the
    # literal string "undefined" — clients MUST normalize to null.
    post = {
        "id": 2,
        "fullLengthSource": "undefined",
        "gfycatSource": "undefined",
        "redgifsSource": "undefined",
        "mediaSources": [
            {"url": "https://images.scrolller.com/small-100x100.webp", "width": 100, "height": 100, "type": "WEBP"},
            {"url": "https://images.scrolller.com/big-800x600.webp", "width": 800, "height": 600, "type": "WEBP"},
        ],
    }
    source = best_media_source(post)
    assert source["url"] == "https://images.scrolller.com/big-800x600.webp"


def test_undefined_url_inside_dict_source_is_ignored():
    post = {
        "id": 3,
        "mediaSources": [
            {"url": "undefined", "width": 9999, "height": 9999, "type": "MP4"},
            {"url": "https://images.scrolller.com/real-300x200.jpg", "width": 300, "height": 200, "type": "JPEG"},
        ],
    }
    assert best_media_source(post)["url"] == "https://images.scrolller.com/real-300x200.jpg"


def test_largest_area_wins_when_no_full_length():
    post = {
        "id": 4,
        "mediaSources": [
            {"url": "https://h/a-540x957.webp", "width": 540, "height": 957, "type": "WEBP"},
            {"url": "https://h/a-1080x1440.webp", "width": 1080, "height": 1440, "type": "WEBP"},
            {"url": "https://h/a-540x405.jpg", "width": 540, "height": 405, "type": "JPEG"},
        ],
    }
    assert best_media_source(post)["width"] == 1080


def test_no_sources_raises_download_error():
    with pytest.raises(DownloadError):
        best_media_source({"id": 5, "mediaSources": []})
    with pytest.raises(DownloadError):
        best_media_source({"id": 6, "fullLengthSource": "undefined"})


def test_extension_from_url_and_type():
    assert _extension({"url": "https://h/a.mp4?token=1"}, "jpg") == "mp4"
    assert _extension({"url": "https://h/noext", "type": "WEBP"}, "jpg") == "webp"
    assert _extension({"url": "https://h/noext"}, "jpg") == "jpg"


def test_resolve_path_never_overwrites(tmp_path):
    first = _resolve_path(tmp_path, "1-sub-100x100", "jpg")
    first.touch()
    second = _resolve_path(tmp_path, "1-sub-100x100", "jpg")
    assert second.name == "1-sub-100x100-1.jpg"
    second.touch()
    third = _resolve_path(tmp_path, "1-sub-100x100", "jpg")
    assert third.name == "1-sub-100x100-2.jpg"

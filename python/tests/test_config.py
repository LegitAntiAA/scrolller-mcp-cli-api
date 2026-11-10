"""Unit tests for config resolution and proxy URL parsing (no network)."""

import os
from pathlib import Path

import pytest

from scrolller._config import (
    DEFAULT_CONFIG,
    apply_env_overrides,
    build_client_options,
    deep_merge,
    default_config_path,
    load_config_file,
    resolve_config,
    save_config_file,
)
from scrolller._errors import ProxyError, ScrolllerError
from scrolller._proxy import as_proxy_config, httpx_proxy_url, parse_proxy_url
from scrolller._types import NsfwFilter, ProxyConfig, ProxyType


# ---------------------------------------------------------------- deep merge


def test_deep_merge_nested_and_replace():
    base = {"a": {"x": 1, "y": 2}, "extra_headers": {"h1": "1"}}
    override = {"a": {"y": 3, "z": 4}, "extra_headers": {"h2": "2"}}
    merged = deep_merge(base, override)
    assert merged == {"a": {"x": 1, "y": 3, "z": 4}, "extra_headers": {"h1": "1", "h2": "2"}}
    # base must not be mutated
    assert base["a"] == {"x": 1, "y": 2}
    assert base["extra_headers"] == {"h1": "1"}


def test_deep_merge_non_dict_replaces_dict():
    assert deep_merge({"proxy": {"host": "a"}}, {"proxy": None})["proxy"] is None
    assert deep_merge({"proxy": None}, {"proxy": {"host": "b"}})["proxy"] == {"host": "b"}


# ------------------------------------------------------------ config paths


def test_default_path_windows(monkeypatch, tmp_path):
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    assert default_config_path(is_windows=True) == tmp_path / ".config" / "scrolller" / "config.json"


def test_default_path_windows_falls_back_to_home(monkeypatch, tmp_path):
    monkeypatch.delenv("USERPROFILE", raising=False)
    assert default_config_path(is_windows=True) == Path.home() / ".config" / "scrolller" / "config.json"


def test_default_path_xdg(monkeypatch, tmp_path):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "xdg"))
    assert default_config_path(is_windows=False) == tmp_path / "xdg" / "scrolller" / "config.json"
    monkeypatch.delenv("XDG_CONFIG_HOME")
    assert default_config_path(is_windows=False) == Path.home() / ".config" / "scrolller" / "config.json"


# ------------------------------------------------------------- file load/save


def test_load_missing_file_returns_empty(tmp_path):
    assert load_config_file(tmp_path / "absent.json") == {}


def test_load_malformed_config_raises(tmp_path):
    cfg_path = tmp_path / "config.json"
    cfg_path.write_text("{not json", encoding="utf-8")
    with pytest.raises(ScrolllerError):
        load_config_file(cfg_path)


def test_load_non_object_config_raises(tmp_path):
    cfg_path = tmp_path / "config.json"
    cfg_path.write_text("[1, 2]", encoding="utf-8")
    with pytest.raises(ScrolllerError):
        load_config_file(cfg_path)


def test_save_load_roundtrip(tmp_path):
    cfg_path = tmp_path / "sub" / "config.json"
    save_config_file(cfg_path, {"token": "abc", "proxy": {"type": "http", "host": "p", "port": 8080}})
    loaded = load_config_file(cfg_path)
    assert loaded["token"] == "abc"
    assert loaded["proxy"]["port"] == 8080


# ------------------------------------------------------------- env overrides


def test_env_overrides(monkeypatch):
    monkeypatch.setenv("SCROLLLER_TOKEN", "tok")
    monkeypatch.setenv("SCROLLLER_NSFW", "all")
    monkeypatch.setenv("SCROLLLER_USER_AGENT", "UA/1.0")
    monkeypatch.setenv("SCROLLLER_EXTRA_HEADERS", '{"X-Test": "1"}')
    monkeypatch.setenv("SCROLLLER_PROXY", "socks5://user:pw@127.0.0.1:1080")
    monkeypatch.setenv("SCROLLLER_DOWNLOAD_DIR", "D:/dl")
    cfg = apply_env_overrides(dict(DEFAULT_CONFIG))
    assert cfg["token"] == "tok"
    assert cfg["nsfw"] == "ALL"
    assert cfg["user_agent"] == "UA/1.0"
    assert cfg["extra_headers"] == {"X-Test": "1"}
    assert cfg["proxy"] == {
        "type": "socks5",
        "host": "127.0.0.1",
        "port": 1080,
        "username": "user",
        "password": "pw",
    }
    assert cfg["download_dir"] == "D:/dl"


def test_env_empty_token_ignored():
    # Whitespace-only token must be treated as unset (F12: exercise the path).
    cfg = apply_env_overrides(dict(DEFAULT_CONFIG), environ={"SCROLLLER_TOKEN": "   "})
    assert cfg["token"] is None


def test_env_invalid_nsfw_raises(monkeypatch):
    monkeypatch.setenv("SCROLLLER_NSFW", "MAYBE")
    with pytest.raises(ScrolllerError):
        apply_env_overrides(dict(DEFAULT_CONFIG))


def test_env_invalid_extra_headers_raises(monkeypatch):
    monkeypatch.setenv("SCROLLLER_EXTRA_HEADERS", "not-json")
    with pytest.raises(ScrolllerError):
        apply_env_overrides(dict(DEFAULT_CONFIG))


def test_env_invalid_proxy_raises(monkeypatch):
    monkeypatch.setenv("SCROLLLER_PROXY", "ftp://h:1")
    with pytest.raises(ProxyError):
        apply_env_overrides(dict(DEFAULT_CONFIG))


# --------------------------------------------------------------- precedence


def test_precedence_explicit_beats_env_beats_file_beats_defaults(monkeypatch, tmp_path):
    cfg_path = tmp_path / "config.json"
    save_config_file(cfg_path, {"token": "file-token", "timeout_ms": 9999, "download_dir": "~/from-file"})
    monkeypatch.setenv("SCROLLLER_TOKEN", "env-token")
    monkeypatch.delenv("SCROLLLER_DOWNLOAD_DIR", raising=False)

    # env > file > defaults
    options = build_client_options(config_path=str(cfg_path))
    assert options.token == "env-token"
    assert options.timeout_ms == 9999
    assert options.download_dir == "~/from-file"

    # explicit > env
    options = build_client_options(config_path=str(cfg_path), token="arg-token", timeout_ms=1234)
    assert options.token == "arg-token"
    assert options.timeout_ms == 1234

    # no file, no env -> defaults
    monkeypatch.delenv("SCROLLLER_TOKEN", raising=False)
    options = build_client_options(config_path=str(tmp_path / "absent.json"))
    assert options.token is None
    assert options.nsfw == NsfwFilter.SFW
    assert options.timeout_ms == DEFAULT_CONFIG["timeout_ms"]


def test_resolve_config_fills_defaults(tmp_path):
    cfg_path = tmp_path / "config.json"
    save_config_file(cfg_path, {"nsfw": "ALL"})
    cfg = resolve_config(str(cfg_path), environ={})
    assert cfg["nsfw"] == "ALL"
    assert cfg["timeout_ms"] == DEFAULT_CONFIG["timeout_ms"]
    assert cfg["token"] is None


def test_build_client_options_coercions(tmp_path):
    options = build_client_options(
        config_path=str(tmp_path / "none.json"),
        environ={},
        proxy={"type": "socks5", "host": "h", "port": 1080},
        nsfw="ALL",
        extra_headers={"X-A": "b"},
    )
    assert options.proxy == ProxyConfig(type="socks5", host="h", port=1080)
    assert options.nsfw == NsfwFilter.ALL
    assert options.extra_headers == {"X-A": "b"}
    assert options.base_url == "https://api.scrolller.com/admin"
    assert options.read_retries == 1


def test_base_url_not_read_from_config_file(tmp_path):
    # F14: base_url is a constructor option only, never loaded from the file.
    cfg_path = tmp_path / "config.json"
    save_config_file(cfg_path, {"base_url": "https://attacker.example/admin"})
    options = build_client_options(config_path=str(cfg_path), environ={})
    assert options.base_url == "https://api.scrolller.com/admin"
    explicit = build_client_options(
        config_path=str(cfg_path), environ={}, base_url="https://custom.example/admin"
    )
    assert explicit.base_url == "https://custom.example/admin"


# -------------------------------------------------------------- proxy URLs


def test_parse_proxy_url_variants():
    cfg = parse_proxy_url("http://host:8080")
    assert (cfg.type, cfg.host, cfg.port, cfg.username, cfg.password) == (
        ProxyType.HTTP, "host", 8080, None, None
    )

    cfg = parse_proxy_url("HTTPS://Proxy.example:3128")
    assert (cfg.type.value, cfg.host, cfg.port) == ("https", "proxy.example", 3128)

    cfg = parse_proxy_url("socks5://u%40x:p%23w@127.0.0.1:1080")
    assert cfg.type == ProxyType.SOCKS5
    assert cfg.username == "u@x"
    assert cfg.password == "p#w"

    cfg = parse_proxy_url("socks4://h:1080")
    assert cfg.type == ProxyType.SOCKS4


@pytest.mark.parametrize(
    "bad",
    ["", "   ", "ftp://h:1", "socks5://only-host", "socks5://host:notaport", "http://", 42],
)
def test_parse_proxy_url_rejects_invalid(bad):
    with pytest.raises(ProxyError):
        parse_proxy_url(bad)


def test_httpx_proxy_url_auth_quoting():
    assert httpx_proxy_url(ProxyConfig(type="socks5", host="h", port=1080)) == "socks5://h:1080"
    assert (
        httpx_proxy_url(ProxyConfig(type="http", host="h", port=8080, username="u", password="p:1"))
        == "http://u:p%3A1@h:8080"
    )


def test_httpx_proxy_url_ipv6_bracketed():
    # F20: IPv6 literals must be bracketed in the URL.
    assert httpx_proxy_url(ProxyConfig(type="socks5", host="::1", port=1080)) == "socks5://[::1]:1080"
    assert (
        httpx_proxy_url(
            ProxyConfig(type="http", host="2001:db8::1", port=8080, username="u", password="p")
        )
        == "http://u:p@[2001:db8::1]:8080"
    )


def test_as_proxy_config_variants():
    assert as_proxy_config(None) is None
    cfg = as_proxy_config({"type": "https", "host": "h", "port": 443, "username": None, "password": None})
    assert isinstance(cfg, ProxyConfig)
    assert cfg.type.value == "https"
    assert as_proxy_config("socks4://h:1080").type == ProxyType.SOCKS4
    same = ProxyConfig(type="http", host="h", port=1)
    assert as_proxy_config(same) is same
    with pytest.raises(ProxyError):
        as_proxy_config(42)
    with pytest.raises(ProxyError):
        as_proxy_config({"type": "bogus", "host": "h", "port": 1})

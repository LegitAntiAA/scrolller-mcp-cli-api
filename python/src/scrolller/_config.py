"""Config file + environment resolution (CONTRACT.md §3).

Precedence: explicit argument > environment > config file > defaults.

Default config path: ``%USERPROFILE%/.config/scrolller/config.json`` on
Windows, ``~/.config/scrolller/config.json`` otherwise (XDG respected).
Environment variables: SCROLLLER_TOKEN, SCROLLLER_NSFW, SCROLLLER_USER_AGENT,
SCROLLLER_EXTRA_HEADERS (JSON), SCROLLLER_PROXY (``type://[user:pass@]host:port``),
SCROLLLER_DOWNLOAD_DIR.

NOTE: the config file stores the auth token (and proxy password) in
PLAINTEXT. On POSIX the file is written with 0600 permissions; on Windows
normal ACLs apply (not managed here).
"""

from __future__ import annotations

import contextlib
import json
import os
from pathlib import Path
from typing import Any, Dict, Mapping, Optional, Union

from scrolller._errors import ScrolllerError
from scrolller._proxy import as_proxy_config
from scrolller._types import (
    DEFAULT_BASE_URL,
    DEFAULT_READ_RETRIES,
    DEFAULT_TIMEOUT_MS,
    ClientOptions,
    NsfwFilter,
)

CONFIG_DIR_NAME = "scrolller"
CONFIG_FILE_NAME = "config.json"

DEFAULT_CONFIG: Dict[str, Any] = {
    "token": None,
    "nsfw": NsfwFilter.SFW.value,
    "user_agent": None,
    "extra_headers": {},
    "proxy": None,
    "download_dir": "~/Downloads/scrolller",
    "timeout_ms": DEFAULT_TIMEOUT_MS,
}


def default_config_path(*, is_windows: Optional[bool] = None) -> Path:
    """Config file location per CONTRACT.md §3.

    ``is_windows`` overrides the platform check (``os.name == "nt"``) so the
    Windows/POSIX branches are testable on any host.
    """
    windows = (os.name == "nt") if is_windows is None else is_windows
    if windows:
        profile = os.environ.get("USERPROFILE")
        base = Path(profile) if profile else Path.home()
        return base / ".config" / CONFIG_DIR_NAME / CONFIG_FILE_NAME
    xdg = os.environ.get("XDG_CONFIG_HOME")
    base = Path(xdg) if xdg else Path.home() / ".config"
    return base / CONFIG_DIR_NAME / CONFIG_FILE_NAME


def deep_merge(
    base: Mapping[str, Any], override: Mapping[str, Any]
) -> Dict[str, Any]:
    """Recursively merge ``override`` onto ``base``; dicts merge, rest replaces."""
    merged: Dict[str, Any] = dict(base)
    for key, value in override.items():
        if isinstance(value, Mapping) and isinstance(merged.get(key), Mapping):
            merged[key] = deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def load_config_file(path: Union[str, os.PathLike]) -> Dict[str, Any]:
    """Read a config JSON file. Missing file -> ``{}``; malformed -> ScrolllerError."""
    path = Path(path)
    if not path.is_file():
        return {}
    try:
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw) if raw.strip() else {}
    except (OSError, ValueError) as exc:
        raise ScrolllerError(f"cannot read config file {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ScrolllerError(f"config file {path} must contain a JSON object")
    return data


def save_config_file(path: Union[str, os.PathLike], data: Mapping[str, Any]) -> None:
    """Atomically write config JSON (parent directories created).

    The file may hold the token/proxy password in plaintext, so on POSIX it
    is written with 0600 permissions (temp file included). Windows ACLs are
    left to the user.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    if os.name != "nt":
        with contextlib.suppress(OSError):
            os.chmod(tmp, 0o600)
    os.replace(tmp, path)
    if os.name != "nt":
        with contextlib.suppress(OSError):
            os.chmod(path, 0o600)


def parse_extra_headers(raw: str) -> Dict[str, str]:
    """Parse the SCROLLLER_EXTRA_HEADERS JSON object."""
    try:
        data = json.loads(raw)
    except ValueError as exc:
        raise ScrolllerError(f"SCROLLLER_EXTRA_HEADERS is not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ScrolllerError("SCROLLLER_EXTRA_HEADERS must be a JSON object")
    return {str(key): str(value) for key, value in data.items()}


def apply_env_overrides(
    config: Mapping[str, Any], environ: Optional[Mapping[str, str]] = None
) -> Dict[str, Any]:
    """Layer SCROLLLER_* environment variables over an already-loaded config."""
    env = os.environ if environ is None else environ
    overrides: Dict[str, Any] = {}

    token = env.get("SCROLLLER_TOKEN")
    if token is not None and token.strip():
        overrides["token"] = token

    nsfw = env.get("SCROLLLER_NSFW")
    if nsfw:
        try:
            overrides["nsfw"] = NsfwFilter(nsfw.strip().upper()).value
        except ValueError as exc:
            raise ScrolllerError(
                f"SCROLLLER_NSFW must be one of SFW, NSFW, ALL (got {nsfw!r})"
            ) from exc

    user_agent = env.get("SCROLLLER_USER_AGENT")
    if user_agent:
        overrides["user_agent"] = user_agent

    raw_headers = env.get("SCROLLLER_EXTRA_HEADERS")
    if raw_headers:
        overrides["extra_headers"] = parse_extra_headers(raw_headers)

    raw_proxy = env.get("SCROLLLER_PROXY")
    if raw_proxy:
        proxy = as_proxy_config(raw_proxy)
        if proxy is not None:
            overrides["proxy"] = proxy.to_dict()

    download_dir = env.get("SCROLLLER_DOWNLOAD_DIR")
    if download_dir:
        overrides["download_dir"] = download_dir

    return deep_merge(config, overrides)


def resolve_config(
    config_path: Optional[str] = None, environ: Optional[Mapping[str, str]] = None
) -> Dict[str, Any]:
    """defaults <- config file <- environment, as a JSON-shaped dict."""
    path = Path(config_path) if config_path else default_config_path()
    merged = deep_merge(DEFAULT_CONFIG, load_config_file(path))
    return apply_env_overrides(merged, environ)


def _coerce_nsfw(value: Any) -> NsfwFilter:
    if value is None:
        return NsfwFilter.SFW
    if isinstance(value, NsfwFilter):
        return value
    try:
        return NsfwFilter(str(value).upper())
    except ValueError as exc:
        raise ScrolllerError(
            f"invalid nsfw value {value!r}; expected SFW, NSFW or ALL"
        ) from exc


def _coerce_headers(value: Any) -> Dict[str, str]:
    if value is None:
        return {}
    if isinstance(value, Mapping):
        return {str(key): str(val) for key, val in value.items()}
    raise ScrolllerError("extra_headers must be an object (mapping of strings)")


def _coerce_int(name: str, value: Any, default: int) -> int:
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise ScrolllerError(f"{name} must be an integer, got {value!r}") from exc


def build_client_options(
    config_path: Optional[str] = None,
    environ: Optional[Mapping[str, str]] = None,
    *,
    token: Optional[str] = None,
    nsfw: Any = None,
    user_agent: Optional[str] = None,
    extra_headers: Any = None,
    proxy: Any = None,
    timeout_ms: Any = None,
    base_url: Optional[str] = None,
    download_dir: Optional[str] = None,
    read_retries: Any = None,
) -> ClientOptions:
    """Resolve effective :class:`ClientOptions`: explicit > env > file > defaults.

    ``None`` constructor arguments mean "not set" and fall through the chain.
    """
    resolved_path = Path(config_path) if config_path else default_config_path()
    cfg = resolve_config(str(resolved_path), environ)

    def pick(explicit: Any, key: str) -> Any:
        return explicit if explicit is not None else cfg.get(key)

    return ClientOptions(
        token=pick(token, "token") or None,
        nsfw=_coerce_nsfw(pick(nsfw, "nsfw")),
        user_agent=pick(user_agent, "user_agent") or None,
        extra_headers=_coerce_headers(pick(extra_headers, "extra_headers")),
        proxy=as_proxy_config(pick(proxy, "proxy")),
        timeout_ms=_coerce_int("timeout_ms", pick(timeout_ms, "timeout_ms"), DEFAULT_TIMEOUT_MS),
        # base_url is a constructor option only — deliberately not read from the
        # config file schema (CONTRACT.md §3).
        base_url=base_url if base_url is not None else DEFAULT_BASE_URL,
        download_dir=pick(download_dir, "download_dir"),
        read_retries=_coerce_int("read_retries", pick(read_retries, "read_retries"), DEFAULT_READ_RETRIES),
        config_path=str(resolved_path),
    )

"""Proxy plumbing: ProxyConfig <-> httpx proxy URL (CONTRACT.md §4).

http/https/socks4/socks5 are supported; SOCKS requires the ``httpx[socks]``
extra (declared in pyproject). All failures map to :class:`ProxyError`.
"""

from __future__ import annotations

import urllib.parse
from typing import Any, Optional

from scrolller._errors import ProxyError
from scrolller._types import ProxyConfig, ProxyType

SUPPORTED_SCHEMES = ("http", "https", "socks4", "socks5")


def parse_proxy_url(url: str) -> ProxyConfig:
    """Parse ``type://[user:pass@]host:port`` (SCROLLLER_PROXY env form)."""
    if not isinstance(url, str) or not url.strip():
        raise ProxyError("proxy URL must be a non-empty string")
    parsed = urllib.parse.urlparse(url.strip())
    scheme = (parsed.scheme or "").lower()
    if scheme not in SUPPORTED_SCHEMES:
        raise ProxyError(
            f"unsupported proxy type {scheme!r}; expected one of: {', '.join(SUPPORTED_SCHEMES)}"
        )
    host = parsed.hostname
    if not host:
        raise ProxyError(f"proxy URL {url!r} is missing host")
    try:
        port = parsed.port
    except ValueError as exc:
        raise ProxyError(f"proxy URL {url!r} has an invalid port") from exc
    if port is None:
        raise ProxyError(f"proxy URL {url!r} is missing port")
    username = urllib.parse.unquote(parsed.username) if parsed.username else None
    password = urllib.parse.unquote(parsed.password) if parsed.password else None
    return ProxyConfig(
        type=ProxyType(scheme), host=host, port=port, username=username, password=password
    )


def httpx_proxy_url(config: ProxyConfig) -> str:
    """Build the URL accepted by ``httpx.Client(proxy=...)`` / ``AsyncClient``."""
    auth = ""
    if config.username is not None:
        auth = urllib.parse.quote(config.username, safe="")
        if config.password is not None:
            auth += ":" + urllib.parse.quote(config.password, safe="")
        auth += "@"
    host = config.host
    if ":" in host:  # IPv6 literal must be bracketed in the URL
        host = f"[{host}]"
    return f"{config.type.value}://{auth}{host}:{config.port}"


def as_proxy_config(value: Any) -> Optional[ProxyConfig]:
    """Coerce ``None`` / ProxyConfig / dict (config-file form) / URL string.

    ``None`` stays ``None`` (no proxy). Everything else becomes a
    :class:`ProxyConfig` or raises :class:`ProxyError`.
    """
    if value is None:
        return None
    if isinstance(value, ProxyConfig):
        return value
    if isinstance(value, dict):
        try:
            return ProxyConfig(
                type=value.get("type"),
                host=value.get("host"),
                port=value.get("port"),
                username=value.get("username"),
                password=value.get("password"),
            )
        except (TypeError, ValueError) as exc:
            raise ProxyError(f"invalid proxy configuration: {exc}") from exc
    if isinstance(value, str):
        return parse_proxy_url(value)
    raise ProxyError(f"cannot interpret {type(value).__name__} as proxy configuration")

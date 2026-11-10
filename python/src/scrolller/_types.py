"""Core data types for the Scrolller client.

Dataclasses and enums shared by all modules: content filters, proxy
configuration, client options (CONTRACT.md §2/§3/§4) and download
bookkeeping (CONTRACT.md §7).
"""

from __future__ import annotations

import enum
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

DEFAULT_BASE_URL = "https://api.scrolller.com/admin"
DEFAULT_TIMEOUT_MS = 30000
DEFAULT_READ_RETRIES = 1


class NsfwFilter(str, enum.Enum):
    """NsfwFilter GraphQL enum (RESEARCH.md §2). Default everywhere: SFW."""

    SFW = "SFW"
    NSFW = "NSFW"
    ALL = "ALL"


class GallerySortBy(str, enum.Enum):
    """GallerySortBy GraphQL enum (T1-RESEARCH-FULL.md §4, bundle-verified)."""

    RANDOM = "RANDOM"
    TOP = "TOP"
    HOT = "HOT"
    NEW = "NEW"
    CONTROVERSIAL = "CONTROVERSIAL"


class GalleryFilter(str, enum.Enum):
    """GalleryFilter GraphQL enum (T1-RESEARCH-FULL.md §4, bundle-verified).

    Site UI maps: Photos=PICTURE, Videos=VIDEO, "Videos with Sound"=SOUND
    (the site swaps SOUND→VIDEO in two callers; the client passes the value
    through verbatim).
    """

    CATEGORY = "CATEGORY"
    SUBREDDIT = "SUBREDDIT"
    ALBUM = "ALBUM"
    VIDEO = "VIDEO"
    PICTURE = "PICTURE"
    SOUND = "SOUND"


# Non-GraphQL endpoints (T1-RESEARCH-FULL.md §1, RESEARCH.md §4b).
AGENT_BASE_URL = "https://scrolller.com"
UPLOAD_URL = "https://host8.scrolller.com/upload"


class ProxyType(str, enum.Enum):
    """Proxy transport types (CONTRACT.md §4)."""

    HTTP = "http"
    HTTPS = "https"
    SOCKS4 = "socks4"
    SOCKS5 = "socks5"


class ErrorKind(str, enum.Enum):
    """Normalized error kinds (CONTRACT.md §5)."""

    AUTH_REQUIRED = "AUTH_REQUIRED"
    INVALID_CREDENTIALS = "INVALID_CREDENTIALS"
    INVALID_TOKEN = "INVALID_TOKEN"
    GRAPHQL_ERROR = "GRAPHQL_ERROR"
    RATE_LIMITED = "RATE_LIMITED"
    NETWORK_ERROR = "NETWORK_ERROR"
    PROXY_ERROR = "PROXY_ERROR"
    NOT_FOUND = "NOT_FOUND"
    DOWNLOAD_ERROR = "DOWNLOAD_ERROR"


@dataclass
class ProxyConfig:
    """Proxy configuration (CONTRACT.md §4)."""

    type: ProxyType
    host: str
    port: int
    username: Optional[str] = None
    password: Optional[str] = None

    def __post_init__(self) -> None:
        # Accept plain strings ("socks5") alongside ProxyType values.
        if isinstance(self.type, str):
            self.type = ProxyType(self.type.lower())
        if not isinstance(self.type, ProxyType):
            raise ValueError(
                f"proxy type must be one of http, https, socks4, socks5 (got {self.type!r})"
            )
        self.host = str(self.host)
        self.port = int(self.port)

    def to_dict(self) -> Dict[str, Any]:
        """JSON-serializable form used by the config file (CONTRACT.md §3)."""
        return {
            "type": self.type.value,
            "host": self.host,
            "port": self.port,
            "username": self.username,
            "password": self.password,
        }


@dataclass
class DownloadProgress:
    """Progress event emitted while streaming a media file (CONTRACT.md §7)."""

    post_id: str
    url: str
    bytes_done: int
    bytes_total: Optional[int]
    path: Optional[str] = None
    done: bool = False


@dataclass
class DownloadResult:
    """Per-item outcome of :func:`scrolller.download_many`."""

    post_id: str
    path: Optional[str] = None
    error: Optional[str] = None

    @property
    def ok(self) -> bool:
        return self.error is None and self.path is not None


@dataclass
class ClientOptions:
    """Effective client configuration (CONTRACT.md §2 constructor + §3 file).

    ``user_agent=None`` means "use the bundled realistic browser UA".
    ``config_path`` records where the config was loaded from, so that
    ``set_proxy`` can persist back to the same file.
    """

    token: Optional[str] = None
    nsfw: NsfwFilter = NsfwFilter.SFW
    user_agent: Optional[str] = None
    extra_headers: Dict[str, str] = field(default_factory=dict)
    proxy: Optional[ProxyConfig] = None
    timeout_ms: int = DEFAULT_TIMEOUT_MS
    base_url: str = DEFAULT_BASE_URL
    download_dir: Optional[str] = None
    read_retries: int = DEFAULT_READ_RETRIES
    config_path: Optional[str] = None

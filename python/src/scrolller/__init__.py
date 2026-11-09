"""Scrolller API client library (unofficial).

Media discovery, feeds, search, comments, likes and collections
for scrolller.com. See docs/api/CONTRACT.md for the canonical
operation list shared by all language implementations.
"""

from scrolller._download import download_many, download_media
from scrolller._errors import (
    AuthRequiredError,
    DownloadError,
    GraphQLError,
    InvalidTokenError,
    NetworkError,
    NotFoundError,
    ProxyError,
    RateLimitedError,
    ScrolllerError,
)
from scrolller._types import (
    ClientOptions,
    DownloadProgress,
    DownloadResult,
    ErrorKind,
    NsfwFilter,
    ProxyConfig,
    ProxyType,
)
from scrolller.client import AsyncScrolllerClient, ScrolllerClient

__version__ = "0.1.0"

__all__ = [
    "AsyncScrolllerClient",
    "AuthRequiredError",
    "ClientOptions",
    "DownloadError",
    "DownloadProgress",
    "DownloadResult",
    "ErrorKind",
    "GraphQLError",
    "InvalidTokenError",
    "NetworkError",
    "NotFoundError",
    "NsfwFilter",
    "ProxyConfig",
    "ProxyError",
    "ProxyType",
    "RateLimitedError",
    "ScrolllerClient",
    "ScrolllerError",
    "__version__",
    "download_many",
    "download_media",
]

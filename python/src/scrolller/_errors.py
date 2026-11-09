"""Normalized error hierarchy (CONTRACT.md §5).

All errors derive from :class:`ScrolllerError` and carry a stable
``kind`` (ErrorKind), an optional ``http_status`` and optional
``details``. GraphQL-sourced errors preserve the API ``errors[]`` list.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from scrolller._types import ErrorKind


class ScrolllerError(Exception):
    """Base class for every Scrolller client error."""

    default_kind: Optional[ErrorKind] = None

    def __init__(
        self,
        message: str,
        *,
        kind: Optional[ErrorKind] = None,
        http_status: Optional[int] = None,
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.kind = kind if kind is not None else self.default_kind
        self.http_status = http_status
        self.details: Dict[str, Any] = details or {}


class AuthRequiredError(ScrolllerError):
    """An auth-required operation was attempted without a token.

    CONTRACT.md §5.1 specifies this is raised fail-fast (before any network
    call) when a locked operation runs without a token — implemented with the
    operation methods. The alias ``ScrolllerAuthRequiredError`` matches the
    name used in CONTRACT.md §5.1.
    """

    default_kind = ErrorKind.AUTH_REQUIRED


# CONTRACT.md §5.1 names the Python class ScrolllerAuthRequiredError.
ScrolllerAuthRequiredError = AuthRequiredError


class GraphQLError(ScrolllerError):
    """The API returned a GraphQL ``errors[]`` list (or an unexpected HTTP status)."""

    default_kind = ErrorKind.GRAPHQL_ERROR

    def __init__(
        self,
        message: str,
        *,
        errors: Optional[List[Dict[str, Any]]] = None,
        http_status: Optional[int] = None,
    ) -> None:
        self.errors: List[Dict[str, Any]] = list(errors or [])
        super().__init__(message, http_status=http_status)


class InvalidTokenError(GraphQLError):
    """The API rejected the supplied token (UNAUTHENTICATED/FORBIDDEN)."""

    default_kind = ErrorKind.INVALID_TOKEN


class InvalidCredentialsError(GraphQLError):
    """Login rejected the credentials (server signals via generic message)."""

    default_kind = ErrorKind.INVALID_CREDENTIALS


class RateLimitedError(ScrolllerError):
    """The API answered HTTP 429."""

    default_kind = ErrorKind.RATE_LIMITED


class NetworkError(ScrolllerError):
    """Connection failure, timeout, or unusable HTTP response."""

    default_kind = ErrorKind.NETWORK_ERROR


class ProxyError(ScrolllerError):
    """Proxy misconfiguration or proxy connection failure."""

    default_kind = ErrorKind.PROXY_ERROR


class NotFoundError(ScrolllerError):
    """HTTP 404 from the API or a media host."""

    default_kind = ErrorKind.NOT_FOUND


class DownloadError(ScrolllerError):
    """A media download could not be completed."""

    default_kind = ErrorKind.DOWNLOAD_ERROR

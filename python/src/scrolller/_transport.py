"""GraphQL transport (RESEARCH.md §1, CONTRACT.md §1).

POST ``{"query": ..., "variables": ..., "authorization": token|null}`` to the
API endpoint — the token is a **body field**, not a header. Responses are
classified into the normalized errors of CONTRACT.md §5. Idempotent reads may
retry once on 5xx/network errors (configurable); mutations never retry.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Mapping, Optional

import httpx

from scrolller._errors import (
    GraphQLError,
    InvalidCredentialsError,
    InvalidTokenError,
    NetworkError,
    NotFoundError,
    ProxyError,
    RateLimitedError,
)
from scrolller._proxy import httpx_proxy_url
from scrolller._types import (
    DEFAULT_BASE_URL,
    DEFAULT_READ_RETRIES,
    DEFAULT_TIMEOUT_MS,
    ProxyConfig,
)

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
ORIGIN = "https://scrolller.com"

_AUTH_ERROR_CODES = {"UNAUTHENTICATED", "FORBIDDEN"}
# The server reports wrong login credentials via a generic INTERNAL_SERVER_ERROR
# code and this exact message (CONTRACT.md §5.1, RESEARCH.md §3a) — match by message.
_INVALID_CREDENTIALS_MESSAGE = "Username or password is incorrect"


def _build_client(
    *, proxy: Optional[ProxyConfig], timeout_ms: int, async_client: bool = False
) -> Any:
    """Create an httpx client with proxy + timeout applied (CONTRACT.md §4)."""
    proxy_url = httpx_proxy_url(proxy) if proxy is not None else None
    kwargs: Dict[str, Any] = {
        "timeout": httpx.Timeout(timeout_ms / 1000.0),
        "follow_redirects": True,  # media hosts may redirect; never save a 3xx body
    }
    if proxy_url is not None:
        kwargs["proxy"] = proxy_url
    cls = httpx.AsyncClient if async_client else httpx.Client
    try:
        return cls(**kwargs)
    except ImportError as exc:  # socks:// URL without the httpx[socks] extra
        # httpx's message does not embed the proxy URL — safe to forward.
        raise ProxyError(f"SOCKS proxy requires the httpx[socks] extra: {exc}") from exc
    except ValueError as exc:
        # httpx rejects unsupported schemes (e.g. socks4) with a bare ValueError
        # whose text embeds the full proxy URL, including credentials — raise a
        # credential-free message instead.
        scheme = proxy.type.value if proxy is not None else None
        if scheme is not None:
            message = (
                f"Unsupported proxy scheme {scheme!r} — Python client supports "
                "http/https/socks5 (use the Node.js client for socks4)"
            )
        else:
            message = "cannot initialize proxy (httpx rejected the proxy configuration)"
        raise ProxyError(message) from exc
    except httpx.HTTPError as exc:
        raise ProxyError(f"cannot initialize proxy: {exc}") from exc


def _request_headers(
    user_agent: Optional[str], extra_headers: Optional[Mapping[str, str]]
) -> Dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "Accept": "*/*",
        "Origin": ORIGIN,
        "User-Agent": user_agent or DEFAULT_USER_AGENT,
    }
    if extra_headers:
        headers.update({str(key): str(value) for key, value in extra_headers.items()})
    return headers


def _build_payload(query: str, variables: Any, token: Optional[str]) -> bytes:
    """Build the POST body; the token is a body field (RESEARCH.md §1).

    Nullable variables are sent by OMITTING them: explicit nulls for e.g.
    $filter/$excludeFilters/$includeFilters make the server answer
    INTERNAL_SERVER_ERROR (verified live; T1-RESEARCH-FULL.md §7). Omission
    is equivalent for every documented nullable variable, including
    $iterator (first page).
    """
    clean_variables = {
        key: value for key, value in (variables or {}).items() if value is not None
    }
    payload = {
        "query": query,
        "variables": clean_variables,
        "authorization": token,
    }
    return json.dumps(payload).encode("utf-8")


def _extract_graphql_errors(response: Any) -> List[Dict[str, Any]]:
    """Best-effort ``errors[]`` extraction from a response body."""
    try:
        body = response.json()
    except ValueError:
        return []
    if isinstance(body, dict) and isinstance(body.get("errors"), list):
        return body["errors"]
    return []


def _error_message(errors: List[Dict[str, Any]], fallback: str) -> str:
    if errors:
        first = errors[0]
        if isinstance(first, dict):
            message = str(first.get("message") or fallback)
            code = (first.get("extensions") or {}).get("code")
            return f"{message} [code={code}]" if code else message
        return str(first)
    return fallback


def _raise_for_graphql_errors(
    errors: List[Dict[str, Any]], *, http_status: Optional[int] = None
) -> None:
    """Raise the normalized error matching a non-empty GraphQL ``errors[]`` list."""
    raw_message = ""
    code = ""
    if errors and isinstance(errors[0], dict):
        raw_message = str(errors[0].get("message") or "")
        code = str((errors[0].get("extensions") or {}).get("code") or "")
    message = _error_message(errors, "GraphQL error")
    if code in _AUTH_ERROR_CODES:
        raise InvalidTokenError(message, errors=errors, http_status=http_status)
    if raw_message.strip() == _INVALID_CREDENTIALS_MESSAGE:
        raise InvalidCredentialsError(message, errors=errors, http_status=http_status)
    raise GraphQLError(message, errors=errors, http_status=http_status)


def _interpret_response(response: Any) -> Any:
    """Classify one 2xx-4xx response: return the GraphQL ``data`` or raise."""
    status = response.status_code
    if status == 429:
        raise RateLimitedError("rate limited (HTTP 429)", http_status=429)
    if status == 404:
        raise NotFoundError("endpoint not found (HTTP 404)", http_status=404)
    if status >= 400:
        errors = _extract_graphql_errors(response)
        if errors:
            _raise_for_graphql_errors(errors, http_status=status)
        raise GraphQLError(f"HTTP {status} from Scrolller API", http_status=status)
    try:
        body = response.json()
    except ValueError as exc:
        raise NetworkError(f"invalid JSON in API response: {exc}") from exc
    if not isinstance(body, dict):
        raise NetworkError("unexpected non-object API response body")
    body_errors = body.get("errors") or []
    if body_errors:
        _raise_for_graphql_errors(body_errors, http_status=status)
    return body.get("data")


class Transport:
    """Synchronous GraphQL transport over a shared ``httpx.Client``.

    The same client serves media downloads so the proxy applies to both
    (CONTRACT.md §4); access it via :attr:`http_client`.
    """

    def __init__(
        self,
        *,
        base_url: str = DEFAULT_BASE_URL,
        user_agent: Optional[str] = None,
        extra_headers: Optional[Mapping[str, str]] = None,
        proxy: Optional[ProxyConfig] = None,
        timeout_ms: int = DEFAULT_TIMEOUT_MS,
        read_retries: int = DEFAULT_READ_RETRIES,
    ) -> None:
        self.base_url = base_url
        self.user_agent = user_agent
        self.extra_headers = dict(extra_headers or {})
        self.proxy = proxy
        self.timeout_ms = timeout_ms
        self.read_retries = read_retries
        self.http_client = _build_client(proxy=proxy, timeout_ms=timeout_ms)

    def close(self) -> None:
        """Close the underlying HTTP client (releases the connection pool)."""
        self.http_client.close()

    def set_proxy(self, proxy: Optional[ProxyConfig]) -> None:
        """Swap the live proxy (rebuilds the underlying http client)."""
        self.proxy = proxy
        self.http_client.close()
        self.http_client = _build_client(proxy=proxy, timeout_ms=self.timeout_ms)

    def graphql_request(
        self,
        query: str,
        variables: Any = None,
        token: Optional[str] = None,
        *,
        is_mutation: bool = False,
    ) -> Any:
        """Execute one GraphQL request; return the response ``data`` field."""
        headers = _request_headers(self.user_agent, self.extra_headers)
        content = _build_payload(query, variables, token)
        max_attempts = 1 if is_mutation else 1 + max(0, int(self.read_retries))
        for attempt in range(1, max_attempts + 1):
            try:
                response = self.http_client.post(self.base_url, content=content, headers=headers)
            except httpx.ProxyError as exc:
                raise ProxyError(f"proxy failure calling Scrolller API: {exc}") from exc
            except httpx.TransportError as exc:
                if attempt >= max_attempts:
                    raise NetworkError(f"network error calling Scrolller API: {exc}") from exc
                continue
            if 500 <= response.status_code < 600:
                if attempt >= max_attempts:
                    errors = _extract_graphql_errors(response)
                    if errors:
                        _raise_for_graphql_errors(errors, http_status=response.status_code)
                    raise NetworkError(f"HTTP {response.status_code} from Scrolller API")
                continue  # retry once for idempotent reads
            return _interpret_response(response)
        raise NetworkError("request loop exited unexpectedly")  # pragma: no cover


class AsyncTransport:
    """Async GraphQL transport over ``httpx.AsyncClient``.

    Native async media downloads arrive with the operation-methods phase;
    until then downloads reuse a lazily-created sync client in a worker
    thread (see ``AsyncScrolllerClient.download``).
    """

    def __init__(
        self,
        *,
        base_url: str = DEFAULT_BASE_URL,
        user_agent: Optional[str] = None,
        extra_headers: Optional[Mapping[str, str]] = None,
        proxy: Optional[ProxyConfig] = None,
        timeout_ms: int = DEFAULT_TIMEOUT_MS,
        read_retries: int = DEFAULT_READ_RETRIES,
    ) -> None:
        self.base_url = base_url
        self.user_agent = user_agent
        self.extra_headers = dict(extra_headers or {})
        self.proxy = proxy
        self.timeout_ms = timeout_ms
        self.read_retries = read_retries
        self.http_client = _build_client(proxy=proxy, timeout_ms=timeout_ms, async_client=True)
        self._download_client: Optional[httpx.Client] = None

    @property
    def download_http_client(self) -> httpx.Client:
        if self._download_client is None:
            self._download_client = _build_client(proxy=self.proxy, timeout_ms=self.timeout_ms)
        return self._download_client

    async def aclose(self) -> None:
        """Close the async API client and the lazily-created download client."""
        await self.http_client.aclose()
        if self._download_client is not None:
            self._download_client.close()
            self._download_client = None

    def set_proxy(self, proxy: Optional[ProxyConfig]) -> None:
        """Swap the live proxy (rebuilds the underlying async http client)."""
        # The old AsyncClient is dropped for GC; aclose() would require await.
        self.proxy = proxy
        self.http_client = _build_client(
            proxy=proxy, timeout_ms=self.timeout_ms, async_client=True
        )
        self._download_client = None

    async def graphql_request(
        self,
        query: str,
        variables: Any = None,
        token: Optional[str] = None,
        *,
        is_mutation: bool = False,
    ) -> Any:
        """Execute one GraphQL request; return the response ``data`` field."""
        headers = _request_headers(self.user_agent, self.extra_headers)
        content = _build_payload(query, variables, token)
        max_attempts = 1 if is_mutation else 1 + max(0, int(self.read_retries))
        for attempt in range(1, max_attempts + 1):
            try:
                response = await self.http_client.post(
                    self.base_url, content=content, headers=headers
                )
            except httpx.ProxyError as exc:
                raise ProxyError(f"proxy failure calling Scrolller API: {exc}") from exc
            except httpx.TransportError as exc:
                if attempt >= max_attempts:
                    raise NetworkError(f"network error calling Scrolller API: {exc}") from exc
                continue
            if 500 <= response.status_code < 600:
                if attempt >= max_attempts:
                    errors = _extract_graphql_errors(response)
                    if errors:
                        _raise_for_graphql_errors(errors, http_status=response.status_code)
                    raise NetworkError(f"HTTP {response.status_code} from Scrolller API")
                continue  # retry once for idempotent reads
            return _interpret_response(response)
        raise NetworkError("request loop exited unexpectedly")  # pragma: no cover

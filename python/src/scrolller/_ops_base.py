"""Shared helpers mixed into the client classes for the operation methods.

The operation mixins (``_ops_*.py``) call ``self._request`` /
``self._require_token`` / ``self._nsfw_value`` / ``self._agent_get`` /
``self._upload_put`` / ``self._persist_config_values``; this module provides
them once for the sync and async client classes (CONTRACT.md §2/§5.1).
"""

from __future__ import annotations

import json
import urllib.parse
from pathlib import Path
from typing import Any, Dict, Mapping, Optional, Tuple

from scrolller._config import default_config_path, load_config_file, save_config_file
from scrolller._errors import (
    AuthRequiredError,
    NetworkError,
    NotFoundError,
    RateLimitedError,
    ScrolllerError,
)
from scrolller._graphql import enum_value
from scrolller._transport import DEFAULT_USER_AGENT, ORIGIN, AsyncTransport, Transport
from scrolller._types import AGENT_BASE_URL, ClientOptions

__all__ = ["AsyncClientOpsBase", "ClientOpsBase", "to_absolute_url"]

# CONTRACT.md §5.1 — fail-fast message for 🔒 operations without a token.
AUTH_REQUIRED_MESSAGE = (
    "Authentication required. Call client.login(username, password), pass token "
    "to ScrolllerClient(token=...), or run: scrolller login / scrolller token <token>"
)

_FileLike = Tuple[str, bytes]


def to_absolute_url(value: str) -> str:
    """Make a post/subreddit ref absolute for ``ResolveScrolllerLinks``.

    The resolver only accepts full ``https://scrolller.com/...`` URLs while
    feed post objects carry relative paths like ``"/corvette-..."`` (live
    verified in the CLI/MCP runs). No-op for absolute URLs and bare ids.
    """
    if value.startswith("http://") or value.startswith("https://"):
        return value
    if value.startswith("/") and not value.startswith("//"):
        return "https://scrolller.com" + value
    return value


def _post_id_from_link(link: Any, ref: str) -> int:
    post_id = link.post.id if link is not None and link.post is not None else None
    if isinstance(post_id, int) and not isinstance(post_id, bool):
        return post_id
    raise NotFoundError(f"cannot resolve post id from ref {ref!r}")


def _agent_headers(options: ClientOptions) -> Dict[str, str]:
    headers = {"Accept": "application/json", "User-Agent": options.user_agent or DEFAULT_USER_AGENT}
    for key, value in (options.extra_headers or {}).items():
        headers[str(key)] = str(value)
    return headers


def _interpret_agent_response(url: str, status: int, body: bytes) -> Dict[str, Any]:
    """Classify an agent-route response (parity with the TypeScript ops)."""
    if status == 404:
        raise NotFoundError(f"agent route not found (HTTP 404): {url}", http_status=404)
    if status == 429:
        raise RateLimitedError(
            f"agent route rate limited (HTTP 429): {url} — keep to ~1 request/second",
            http_status=429,
        )
    if status >= 400:
        raise NetworkError(f"HTTP {status} from agent route {url}", http_status=status)
    try:
        parsed = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise NetworkError(f"agent route returned invalid JSON ({url}): {exc}") from exc
    if isinstance(parsed, dict):
        return parsed
    raise NetworkError(f"agent route returned an unexpected body shape ({url})")


class ClientOpsBase:
    """Shared sync helpers; mixed into :class:`scrolller.ScrolllerClient`."""

    _options: ClientOptions
    _transport: Transport

    def _request(
        self,
        query: str,
        variables: Optional[Dict[str, Any]] = None,
        *,
        is_mutation: bool = False,
    ) -> Any:
        """Execute one GraphQL request; return the response ``data`` field."""
        return self._transport.graphql_request(
            query, variables, token=self._options.token, is_mutation=is_mutation
        )

    def _require_token(self) -> str:
        """Fail fast AUTH_REQUIRED for 🔒 operations without a token (§5.1)."""
        token = self._options.token
        if not token:
            raise AuthRequiredError(AUTH_REQUIRED_MESSAGE)
        return token

    def _nsfw_value(self, nsfw: Any = None) -> Optional[str]:
        """Resolve the per-call ``nsfw`` argument against the client default."""
        if nsfw is None:
            return self._options.nsfw.value
        return enum_value(nsfw)

    def _resolve_post_id(self, ref: Any) -> int:
        """Resolve a post ref (int, numeric string, or scrolller URL) to an id.

        URLs go through :meth:`resolve_link` with :func:`to_absolute_url`
        applied (the resolver rejects relative paths). Raises NotFoundError
        when the URL does not resolve to a post.
        """
        if isinstance(ref, bool):
            raise ScrolllerError("post ref must be a post id (int), numeric string, or scrolller URL")
        if isinstance(ref, int):
            return ref
        if isinstance(ref, str):
            trimmed = ref.strip()
            if trimmed.isdigit():
                return int(trimmed)
            if not trimmed:
                raise ScrolllerError("post ref must be a post id (int), numeric string, or scrolller URL")
            link = self.resolve_link(to_absolute_url(trimmed))
            return _post_id_from_link(link, trimmed)
        raise ScrolllerError("post ref must be a post id (int), numeric string, or scrolller URL")

    def _persist_config_values(self, options: ClientOptions, values: Mapping[str, Any]) -> None:
        """Write several keys back to the config file, preserving the rest."""
        path = Path(options.config_path or default_config_path())
        file_cfg = load_config_file(path)
        file_cfg.update(values)
        save_config_file(path, file_cfg)

    def _agent_get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """``GET https://scrolller.com/<path>`` — official agent routes (§6 row 30).

        Public embed-safe JSON (no raw media); server-side rate limit ~1 req/s.
        Errors map like the TypeScript ops: 404 → NotFoundError, 429 →
        RateLimitedError, other non-2xx → NetworkError. Goes through the
        transport's http client so the proxy and timeout apply.
        """
        url = AGENT_BASE_URL + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        try:
            response = self._transport.http_client.get(url, headers=_agent_headers(self._options))
        except Exception as exc:  # httpx.TransportError and any proxy failure
            raise NetworkError(f"agent request failed for {url}: {exc}") from exc
        return _interpret_agent_response(url, response.status_code, response.content)

    def _upload_put(
        self,
        url: str,
        *,
        data: Mapping[str, Any],
        files: Mapping[str, _FileLike],
    ) -> Any:
        """``PUT`` a multipart form (the host8 upload helper, T1 §9).

        ``data`` carries the plain fields (``file_key``, ``Authorization``,
        optional ``blur``); ``files`` the ``content`` file part. Returns the
        parsed JSON body. Goes through the transport's http client so the
        proxy and timeout apply.
        """
        headers: Dict[str, str] = {
            "Accept": "*/*",
            "Origin": ORIGIN,
            "User-Agent": self._options.user_agent or DEFAULT_USER_AGENT,
        }
        for key, value in (self._options.extra_headers or {}).items():
            headers[str(key)] = str(value)
        try:
            response = self._transport.http_client.put(
                url,
                data=dict(data),
                files={name: (name_, payload) for name, (name_, payload) in files.items()},
                headers=headers,
            )
        except Exception as exc:  # httpx.TransportError and any proxy failure
            raise NetworkError(f"upload failed for {url}: {exc}") from exc
        if response.status_code >= 400:
            raise NetworkError(
                f"upload failed: HTTP {response.status_code} from {url}",
                http_status=response.status_code,
            )
        try:
            parsed = json.loads(response.content.decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as exc:
            raise NetworkError(f"upload returned invalid JSON: {exc}") from exc
        if not isinstance(parsed, dict):
            raise NetworkError("upload returned an unexpected response body")
        return parsed


class AsyncClientOpsBase:
    """Shared async helpers; mixed into :class:`scrolller.AsyncScrolllerClient`."""

    _options: ClientOptions
    _transport: AsyncTransport

    async def _request(
        self,
        query: str,
        variables: Optional[Dict[str, Any]] = None,
        *,
        is_mutation: bool = False,
    ) -> Any:
        """Execute one GraphQL request; return the response ``data`` field."""
        return await self._transport.graphql_request(
            query, variables, token=self._options.token, is_mutation=is_mutation
        )

    def _require_token(self) -> str:
        """Fail fast AUTH_REQUIRED for 🔒 operations without a token (§5.1)."""
        token = self._options.token
        if not token:
            raise AuthRequiredError(AUTH_REQUIRED_MESSAGE)
        return token

    def _nsfw_value(self, nsfw: Any = None) -> Optional[str]:
        """Resolve the per-call ``nsfw`` argument against the client default."""
        if nsfw is None:
            return self._options.nsfw.value
        return enum_value(nsfw)

    async def _resolve_post_id(self, ref: Any) -> int:
        """Resolve a post ref (int, numeric string, or scrolller URL) to an id.

        URLs go through :meth:`resolve_link` with :func:`to_absolute_url`
        applied (the resolver rejects relative paths). Raises NotFoundError
        when the URL does not resolve to a post.
        """
        if isinstance(ref, bool):
            raise ScrolllerError("post ref must be a post id (int), numeric string, or scrolller URL")
        if isinstance(ref, int):
            return ref
        if isinstance(ref, str):
            trimmed = ref.strip()
            if trimmed.isdigit():
                return int(trimmed)
            if not trimmed:
                raise ScrolllerError("post ref must be a post id (int), numeric string, or scrolller URL")
            link = await self.resolve_link(to_absolute_url(trimmed))
            return _post_id_from_link(link, trimmed)
        raise ScrolllerError("post ref must be a post id (int), numeric string, or scrolller URL")

    def _persist_config_values(self, options: ClientOptions, values: Mapping[str, Any]) -> None:
        """Write several keys back to the config file, preserving the rest."""
        path = Path(options.config_path or default_config_path())
        file_cfg = load_config_file(path)
        file_cfg.update(values)
        save_config_file(path, file_cfg)

    async def _agent_get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """``GET https://scrolller.com/<path>`` — official agent routes (§6 row 30)."""
        url = AGENT_BASE_URL + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        try:
            response = await self._transport.http_client.get(
                url, headers=_agent_headers(self._options)
            )
        except Exception as exc:  # httpx.TransportError and any proxy failure
            raise NetworkError(f"agent request failed for {url}: {exc}") from exc
        return _interpret_agent_response(url, response.status_code, response.content)

    async def _upload_put(
        self,
        url: str,
        *,
        data: Mapping[str, Any],
        files: Mapping[str, _FileLike],
    ) -> Any:
        """``PUT`` a multipart form (the host8 upload helper, T1 §9)."""
        headers: Dict[str, str] = {
            "Accept": "*/*",
            "Origin": ORIGIN,
            "User-Agent": self._options.user_agent or DEFAULT_USER_AGENT,
        }
        for key, value in (self._options.extra_headers or {}).items():
            headers[str(key)] = str(value)
        try:
            response = await self._transport.http_client.put(
                url,
                data=dict(data),
                files={name: (name_, payload) for name, (name_, payload) in files.items()},
                headers=headers,
            )
        except Exception as exc:  # httpx.TransportError and any proxy failure
            raise NetworkError(f"upload failed for {url}: {exc}") from exc
        if response.status_code >= 400:
            raise NetworkError(
                f"upload failed: HTTP {response.status_code} from {url}",
                http_status=response.status_code,
            )
        try:
            parsed = json.loads(response.content.decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as exc:
            raise NetworkError(f"upload returned invalid JSON: {exc}") from exc
        if not isinstance(parsed, dict):
            raise NetworkError("upload returned an unexpected response body")
        return parsed

"""ScrolllerClient + AsyncScrolllerClient (CONTRACT.md §2).

Transport-phase surface only (CONTRACT.md §6 operation matrix comes later):
``request`` / ``set_token`` / ``config`` / ``set_proxy`` / ``download``.
Config resolution follows CONTRACT.md §3: explicit args > env > file > defaults.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, Dict, Mapping, Optional, Union

from scrolller._config import (
    build_client_options,
    default_config_path,
    load_config_file,
    save_config_file,
)
from scrolller._download import ProgressCallback, download_media
from scrolller._errors import DownloadError
from scrolller._proxy import as_proxy_config
from scrolller._transport import AsyncTransport, Transport
from scrolller._types import ClientOptions

__all__ = ["AsyncScrolllerClient", "ScrolllerClient"]


def _persist_config_value(options: ClientOptions, key: str, value: Any) -> None:
    """Write one key back to the config file, preserving the rest of the file."""
    path = Path(options.config_path or default_config_path())
    file_cfg = load_config_file(path)
    file_cfg[key] = value
    save_config_file(path, file_cfg)


class ScrolllerClient:
    """Minimal synchronous Scrolller client (transport foundation)."""

    def __init__(
        self,
        *,
        token: Optional[str] = None,
        nsfw: Any = None,
        user_agent: Optional[str] = None,
        extra_headers: Optional[Mapping[str, str]] = None,
        proxy: Any = None,
        timeout_ms: Any = None,
        base_url: Optional[str] = None,
        config_path: Optional[str] = None,
        download_dir: Optional[str] = None,
        read_retries: Any = None,
    ) -> None:
        self._options = build_client_options(
            config_path=config_path,
            token=token,
            nsfw=nsfw,
            user_agent=user_agent,
            extra_headers=extra_headers,
            proxy=proxy,
            timeout_ms=timeout_ms,
            base_url=base_url,
            download_dir=download_dir,
            read_retries=read_retries,
        )
        self._transport = Transport(
            base_url=self._options.base_url,
            user_agent=self._options.user_agent,
            extra_headers=self._options.extra_headers,
            proxy=self._options.proxy,
            timeout_ms=self._options.timeout_ms,
            read_retries=self._options.read_retries,
        )

    @property
    def config(self) -> ClientOptions:
        """The effective client configuration."""
        return self._options

    def request(
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

    def set_token(self, token: Optional[str]) -> None:
        """Set or clear the auth token; persists to the config file (§6 row 16b)."""
        self._options.token = token
        _persist_config_value(self._options, "token", token)

    def set_proxy(self, proxy: Any) -> None:
        """Replace the active proxy and persist it to the config file.

        Accepts a :class:`ProxyConfig`, its dict form, or a
        ``type://[user:pass@]host:port`` URL. ``None`` clears the proxy.
        """
        config = as_proxy_config(proxy)
        self._options.proxy = config
        self._transport.set_proxy(config)
        _persist_config_value(self._options, "proxy", config.to_dict() if config is not None else None)

    def close(self) -> None:
        """Release the underlying HTTP connection pool."""
        self._transport.close()

    def __enter__(self) -> "ScrolllerClient":
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        self.close()

    def download(
        self,
        post: Dict[str, Any],
        dir: Optional[Union[str, Path]] = None,
        *,
        progress_callback: Optional[ProgressCallback] = None,
    ) -> Path:
        """Download a post's best media source; return the saved path."""
        target = dir if dir is not None else self._options.download_dir
        if not target:
            raise DownloadError("no download directory given (pass dir or set download_dir)")
        return download_media(
            post, target, progress_callback=progress_callback, client=self._transport.http_client
        )


class AsyncScrolllerClient:
    """Async mirror of :class:`ScrolllerClient` (same minimal surface).

    Native async media streaming arrives with the operation-methods phase;
    ``download`` currently runs the sync downloader in a worker thread
    (``asyncio.to_thread``) against a shared, proxy-aware httpx client.
    """

    def __init__(
        self,
        *,
        token: Optional[str] = None,
        nsfw: Any = None,
        user_agent: Optional[str] = None,
        extra_headers: Optional[Mapping[str, str]] = None,
        proxy: Any = None,
        timeout_ms: Any = None,
        base_url: Optional[str] = None,
        config_path: Optional[str] = None,
        download_dir: Optional[str] = None,
        read_retries: Any = None,
    ) -> None:
        self._options = build_client_options(
            config_path=config_path,
            token=token,
            nsfw=nsfw,
            user_agent=user_agent,
            extra_headers=extra_headers,
            proxy=proxy,
            timeout_ms=timeout_ms,
            base_url=base_url,
            download_dir=download_dir,
            read_retries=read_retries,
        )
        self._transport = AsyncTransport(
            base_url=self._options.base_url,
            user_agent=self._options.user_agent,
            extra_headers=self._options.extra_headers,
            proxy=self._options.proxy,
            timeout_ms=self._options.timeout_ms,
            read_retries=self._options.read_retries,
        )

    @property
    def config(self) -> ClientOptions:
        """The effective client configuration."""
        return self._options

    async def request(
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

    def set_token(self, token: Optional[str]) -> None:
        """Set or clear the auth token; persists to the config file (§6 row 16b)."""
        self._options.token = token
        _persist_config_value(self._options, "token", token)

    def set_proxy(self, proxy: Any) -> None:
        """Replace the active proxy and persist it to the config file."""
        config = as_proxy_config(proxy)
        self._options.proxy = config
        self._transport.set_proxy(config)
        _persist_config_value(self._options, "proxy", config.to_dict() if config is not None else None)

    async def aclose(self) -> None:
        """Release the underlying HTTP connection pools."""
        await self._transport.aclose()

    async def __aenter__(self) -> "AsyncScrolllerClient":
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        await self.aclose()

    async def download(
        self,
        post: Dict[str, Any],
        dir: Optional[Union[str, Path]] = None,
        *,
        progress_callback: Optional[ProgressCallback] = None,
    ) -> Path:
        """Download a post's best media source; return the saved path.

        ``progress_callback`` fires from the worker thread.
        """
        target = dir if dir is not None else self._options.download_dir
        if not target:
            raise DownloadError("no download directory given (pass dir or set download_dir)")
        client = self._transport.download_http_client
        return await asyncio.to_thread(
            download_media, post, target, progress_callback=progress_callback, client=client
        )

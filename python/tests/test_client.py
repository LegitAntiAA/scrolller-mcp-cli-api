"""Unit tests for client lifecycle and constructor-level proxy handling (no network)."""

import pytest

from scrolller._errors import ErrorKind, ProxyError
from scrolller._types import NsfwFilter
from scrolller.client import AsyncScrolllerClient, ScrolllerClient


def test_client_close_and_context_manager(tmp_path):
    client = ScrolllerClient(config_path=str(tmp_path / "none.json"))
    client.close()
    client.close()  # repeated close must be safe
    with ScrolllerClient(config_path=str(tmp_path / "none2.json")) as ctx:
        assert ctx.config.nsfw == NsfwFilter.SFW
    ctx.close()


@pytest.mark.asyncio
async def test_async_client_aclose_and_context_manager(tmp_path):
    client = AsyncScrolllerClient(config_path=str(tmp_path / "none.json"))
    await client.aclose()
    async with AsyncScrolllerClient(config_path=str(tmp_path / "none2.json")) as ctx:
        assert ctx.config.nsfw == NsfwFilter.SFW
    await ctx.aclose()


def test_socks4_proxy_rejected_without_credential_leak(tmp_path):
    # F3 end-to-end: constructor fails fast, message carries the scheme but
    # never the credentials from the proxy URL.
    with pytest.raises(ProxyError) as excinfo:
        ScrolllerClient(
            config_path=str(tmp_path / "none.json"),
            proxy="socks4://alice:hunter2@127.0.0.1:1080",
        )
    message = str(excinfo.value)
    assert "hunter2" not in message
    assert "socks4" in message
    assert excinfo.value.kind == ErrorKind.PROXY_ERROR

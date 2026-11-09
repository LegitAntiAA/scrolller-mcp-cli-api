# scrolller-py

Python API client for [Scrolller](https://scrolller.com) (unofficial).
Part of the [scrolller-mcp-cli-api](../README.md) monorepo — see the root
README for the full documentation, CLI and MCP server.

## Install (after publish)

```bash
pip install scrolller-py
```

## Quickstart

```python
from scrolller import ScrolllerClient

client = ScrolllerClient()
for post in client.discover(page_length=20):
    print(post.media_url)
```

> Full API reference: root README + `docs/api/CONTRACT.md`.

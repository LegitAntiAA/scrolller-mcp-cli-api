# scrolller-mcp-cli-api

**3-in-1 toolkit for [Scrolller](https://scrolller.com)** (unofficial):

| Part | Package | What it is |
| --- | --- | --- |
| 🤖 MCP server | `scrolller-mcp` | Model Context Protocol server — lets AI agents search, download, like, comment and manage collections |
| ⌨️ CLI | `scrolller-cli` | Terminal tool — download videos/images by URL or N-by-query, browse feeds, like, comment, collections |
| 📚 API clients | `scrolller-core` (TypeScript), `scrolller-py` (Python) | Full programmatic access to everything the site can do |

Scrolller hosts both regular (SFW) and NSFW media — NSFW filters are **opt-in** everywhere in this toolkit (off by default).

> ⚠️ **Unofficial project.** Not affiliated with Scrolller. Built by reverse-engineering the site's public web client. Authenticated actions (likes, comments, collections) require your own Scrolller account token. Respect the site's terms and local law; some categories are 18+.

## Features

- 🔍 Discover / search media, browse subreddits and user posts
- ⬇️ Download videos (with audio) and images at original quality
- 💬 Read and write comments
- ❤️ Like / favorite posts
- 📁 Create and manage collections
- 👤 Auth (token), follow subreddits/users, notifications, messages
- 🌡️ Filters: media type (image/animated/gallery), sorting, categories, NSFW opt-in

## Install

### CLI + MCP (Node.js ≥ 18)

```bash
# CLI
npm install -g scrolller-cli
scrolller --help

# MCP server (run by your MCP client, see config below)
npm install -g scrolller-mcp
```

### TypeScript library

```bash
npm install scrolller-core
```

```ts
import { ScrolllerClient } from "scrolller-core";

const client = new ScrolllerClient();

for await (const post of client.discover({ pageLength: 20 })) {
  console.log(post.mediaUrl);
}

await client.download(post, "./out");
```

### Python library

```bash
pip install scrolller-py
```

```python
from scrolller import ScrolllerClient

client = ScrolllerClient()
for post in client.discover(page_length=20):
    print(post.media_url)
```

## CLI quickstart

```bash
scrolller discover                      # trending feed
scrolller search "query" --limit 30     # search
scrolller download <post-url>           # download one post
scrolller download "query" -n 10 -o ./dl   # download 10 items by query
scrolller comments <post-url>           # read comments
scrolller like <post-url>               # requires auth token
scrolller collection create "My pack"   # collections
scrolller donate                        # support the project
```

Auth token: `scrolller login --token <token>` (stored in `~/.config/scrolller/`) — grab it from your browser session. NSFW: add `--nsfw` where supported (off by default).

## MCP server config

Add to your MCP client (Claude Desktop / ZCode / etc.):

```json
{
  "mcpServers": {
    "scrolller": {
      "command": "npx",
      "args": ["-y", "scrolller-mcp"],
      "env": {
        "SCROLLLER_TOKEN": "",
        "SCROLLLER_NSFW": "false"
      }
    }
  }
}
```

Tools mirror the API: `discover`, `search_media`, `get_subreddit_feed`, `get_post`, `read_comments`, `add_comment`, `like_post`, `list_collections`, `create_collection`, `add_to_collection`, `download_media`, … (full list: `docs/api/CONTRACT.md`).

## API coverage

The canonical operation list (extracted from the site's web client) lives in [`docs/api/CONTRACT.md`](docs/api/CONTRACT.md) — all three implementations mirror it 1:1.

## 💖 Donate

If this project saved you time, consider supporting development:

| Currency | Address |
| --- | --- |
| **BTC** | `bc1qw4my95y7uhmg7up7w762qfju04l6960plpkp0u` |
| **Ethereum (ETH)** | `0x9a3e38ffa8d0002e8423a101b98ef214a574abde` |
| **USDT (ERC-20)** | `0x9a3e38ffa8d0002e8423a101b98ef214a574abde` |
| **USDT (TRC-20)** | `TNGrTqLZZdf99zTQoSABvXmAzPTh7NfESk` |
| **TON** | `UQBwZJojKzuIFCpf4V_RSVCSub4J96IWulnfeJ-hYRviB3nw` |

In the CLI: `scrolller donate` prints everything nicely colored. Thank you! 🙏

## Repository layout

```
packages/core    → scrolller-core  (TypeScript client, zero runtime deps)
packages/cli     → scrolller-cli   (terminal CLI, colored ASCII banner)
packages/mcp     → scrolller-mcp   (MCP server, stdio)
python/          → scrolller-py    (Python client, sync + async)
docs/api         → RESEARCH + CONTRACT (canonical API reference)
```

## License

MIT — see [LICENSE](LICENSE).

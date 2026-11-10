<div align="center">

# scrolller-mcp-cli-api

**3-in-1 toolkit for [Scrolller](https://scrolller.com)** (unofficial): 🤖 MCP server for AI agents · ⌨️ terminal CLI · 📚 API clients (TypeScript + Python)

[README на русском](README.ru.md) · [Donate 💖](#-donate)

</div>

---

Scrolller hosts both regular (SFW) and NSFW media — **NSFW is opt-in everywhere in this toolkit** (default `SFW`).

> ⚠️ **Unofficial project.** Not affiliated with Scrolller. Built by reverse-engineering the site's public web client ([protocol reference](docs/api/T1-RESEARCH-FULL.md)). Authenticated actions require **your own** Scrolller account. Respect the site's [usage terms](https://scrolller.com/for-agents) (~1 request/sec pacing is a good habit), content ratings and your local law. Some categories are 18+.

## Features

- 🔍 **Discovery** — trending/random feeds, sorting (`random / top / hot / new / controversial`), media-type filters (photos / videos / videos with sound), categories
- 🔎 **Search** — subreddits (with live preview), users
- 📄 **Posts** — metadata, best media source picking, albums, related ("More like this")
- 💬 **Comments** — read (with replies), write, reply, like/unlike, delete, report
- ❤️ **Likes & reposts**, 👥 **follow/unfollow** subreddits and users, following feeds
- 📁 **Collections** — create/edit/delete, add/remove posts, paid collections
- 🔐 **Auth** — `login(username|email, password)` stores the token (+expiry); or paste a token manually
- 🔔 **Notifications** & ✉️ **messages** (conversations, threads, send, unread count)
- 📤 **Upload** media / create posts (auth), 📊 creator revenue reports (read-only)
- ⬇️ **Downloads** — original-quality videos (MP4/WEBM) and images, bulk by query, concurrency, progress, no-overwrite naming
- 🌐 **Official agent routes** — embed-safe JSON (`/agent/*`, no raw media URLs) for attribution-correct integrations
- 🛡️ **Proxy support** — `http / https / socks4 / socks5` (socks4 via the Node client), interactive wizard, env/CLI overrides
- ⚙️ **Shared config** — one `config.json` + env vars for CLI and MCP; custom **User-Agent** and extra headers
- 🔞 **NSFW opt-in** — `SFW` (default) / `NSFW` / `ALL` on every read operation

## Install

**Node.js ≥ 22.19** required (CLI + MCP + TS library).

### Option 1 — install from GitHub (works right now)

```bash
git clone https://github.com/LegitAntiAA/scrolller-mcp-cli-api
cd scrolller-mcp-cli-api

npm ci && npm run build          # build all Node packages

npm link -w scrolller-cli        # now `scrolller` works in any terminal
npm link -w scrolller-mcp        # now `scrolller-mcp` works (MCP clients run it)

scrolller --help                 # 🎉
```

`npm link` creates global commands pointing at your local build — re-run `npm run build` after pulling updates. The Python library is optional:

```bash
pip install -e python            # Python ≥ 3.9 (add "python[dev]" for tests)
```

### Option 2 — install from the npm registry (once published)

`npm install -g scrolller-cli` downloads the package from the **npm registry**, not GitHub — these commands work after the packages are published there:

```bash
npm install -g scrolller-cli     # CLI
npm install -g scrolller-mcp     # MCP server
npm install scrolller-core       # TypeScript library
pip install scrolller-py         # Python ≥ 3.9 library
```

## CLI quickstart

```bash
scrolller discover --limit 10               # trending feed
scrolller discover --sort top --videos      # filters: --photos --videos --with-sound --sort
scrolller search "burger" --limit 20        # search subreddits
scrolller subreddit aww --limit 30          # subreddit feed
scrolller post <post-url>                   # post details
scrolller comments <post-url>               # read comments

# downloads
scrolller download <post-url>               # one post, original quality
scrolller download "burger" -n 10 -o ./dl   # 10 items by query
scrolller download <post-url> -c 8          # 8 parallel workers

# auth (required for likes/comments/collections/etc.)
scrolller login                             # interactive: username + password
scrolller token <token>                     # or paste a token manually
scrolller whoami

# authenticated actions
scrolller like <post-url>
scrolller comment <post-url> "cool!"
scrolller collection create "My pack"
scrolller collection add <collection-id> <post-url>

# misc
scrolller agent subreddit carporn           # official embed-safe agent route
scrolller proxy                             # interactive proxy wizard (test included)
scrolller config get --json
scrolller donate                            # 💖 crypto addresses
```

Global flags: `--json` (machine output, no banner), `--no-banner`, `--nsfw NSFW`, `--user-agent <ua>`, `--header "K: V"` (repeatable), `--proxy <url>`, `--timeout <ms>`.

## TypeScript library

```ts
import { ScrolllerClient } from "scrolller-core";

const client = new ScrolllerClient();

// paging generator (byte-exact cursors handled for you)
for await (const page of client.discoverPages({ limit: 10, nsfw: "SFW" })) {
  for (const sub of page.items) console.log(sub.title);
}

const post = await client.getPost("https://scrolller.com/some-post-abc123");
await client.download(post, "./out");            // original quality
await client.login("username", "password");      // token persisted to config
await client.like("https://scrolller.com/some-post-abc123");
await client.addComment("https://scrolller.com/some-post-abc123", "cool!");
```

## Python library

```python
from scrolller import ScrolllerClient

client = ScrolllerClient()                # async: AsyncScrolllerClient

for page in client.discover_pages(limit=10):
    for sub in page.items:
        print(sub.title)

post = client.get_post("https://scrolller.com/some-post-abc123")
client.download(post, "./out")
client.login("username", "password")      # token persisted
client.like("https://scrolller.com/some-post-abc123")
```

## MCP server

Everything the CLI can do is exposed as MCP **tools** (`scrolller-mcp`, stdio): `discover`, `search_media`, `subreddit_feed`, `search_subreddits`, `get_post`, `read_comments`, `add_comment`, `reply_comment`, `like_comment`, `delete_comment`, `like_post`, `unlike_post`, `repost_post`, `unrepost_post`, `follow`, `unfollow`, `list_collections`, `get_collection`, `create_collection`, `add_to_collection`, `remove_from_collection`, `edit_collection`, `delete_collection`, `whoami`, `login`, `set_token`, `logout`, `get_notifications`, `mark_notifications`, `get_conversations`, `get_messages`, `send_message`, `get_user`, `resolve_link`, `get_related`, `hide_post`, `unhide_post`, `get_hide_rules`, `report_post`, `download_media`, `agent_subreddit`, `agent_content`, `agent_collection`, `configure_proxy`, `clear_proxy`, `get_config`, `update_config`.

### Claude Desktop

`Claude Desktop → Settings → Developer → Edit Config` (or `claude_desktop_config.json`):

> Installed from source via `npm link`? Use `"command": "scrolller-mcp"` (global command) instead of npx — and re-run `npm run build` after updates.
```json
{
  "mcpServers": {
    "scrolller": {
      "command": "npx",
      "args": ["-y", "scrolller-mcp"],
      "env": { "SCROLLLER_NSFW": "SFW" }
    }
  }
}
```

### Cursor

Cursor → `Settings → MCP & Integrations → MCP Tools → New MCP Server`, or edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "scrolller": {
      "command": "npx",
      "args": ["-y", "scrolller-mcp"]
    }
  }
}
```

### Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.scrolller]
command = "npx"
args = ["-y", "scrolller-mcp"]
```

### Environment variables (work for CLI and MCP)

`SCROLLLER_TOKEN`, `SCROLLLER_NSFW`, `SCROLLLER_USER_AGENT`, `SCROLLLER_EXTRA_HEADERS` (JSON), `SCROLLLER_PROXY` (`type://[user:pass@]host:port`), `SCROLLLER_DOWNLOAD_DIR`.

### Example agent session

Tell your agent:

> "Here is my proxy (host, port, type) — configure it in Scrolller and log in with my credentials, then find and download 10 videos for the query *burger*, like the first 5, and comment *cool* on the first one."

The agent can do exactly that with `configure_proxy` → `login` → `search_media`/`download_media` ×10 → `like_post` ×5 → `add_comment`. Auth-required tools fail with a hint to `login`/`set_token` first, so agents self-correct.

## Configuration

Shared config: `%USERPROFILE%/.config/scrolller/config.json` (Windows) / `~/.config/scrolller/config.json`:

```json
{
  "token": null,
  "expires_at": null,
  "nsfw": "SFW",
  "user_agent": null,
  "extra_headers": {},
  "proxy": { "type": "http", "host": "", "port": 0, "username": null, "password": null },
  "download_dir": "~/Downloads/scrolller",
  "timeout_ms": 30000
}
```

Precedence: explicit option → env → config file → defaults. The token is stored in **plaintext** (file is chmod 600 on POSIX) — treat it like a password.

**Manual token**: log in at scrolller.com in your browser, then copy the token from DevTools → Application → Local Storage → `SCROLLLER_BETA_1:SCROLLLER_LOGIN_DEV`.

## Notes & limits

- **Honest caveat**: authenticated operations (likes, comments, collections, messages, …) are implemented from the site's verified GraphQL shapes but were **not live-tested with a real account** during development — public (no-auth) operations are fully live-verified.
- The site has **no leaderboard / search-collections / global post-search GraphQL** in its current web build (the UI leaderboard page has no public API), so those are not implemented; the official `/agent/collection/{id}` route covers collection lookup.
- `register`, password reset and payments are **captcha-protected** on the server — create accounts on the site, then `scrolller login`.
- `searchCollections` has no public GraphQL document in the current web build (official `/agent/collection/{id}` route works).
- Audio lives inside MP4/WEBM — no separate audio streams exist.
- Rate limits are per-IP; keep ~1 req/s for agent routes and be gentle with the GraphQL endpoint.
- `socks4` proxies are supported by the Node client; the Python client supports `http/https/socks5`.

## Repository layout

```
packages/core    → scrolller-core  (TypeScript client: transport + all operations)
packages/cli     → scrolller-cli   (terminal CLI, colored ASCII banner)
packages/mcp     → scrolller-mcp   (MCP server, stdio)
python/          → scrolller-py    (Python client: sync + async)
docs/api         → CONTRACT (canonical surface) + T1-RESEARCH-FULL (protocol reference)
```

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

## License

MIT — see [LICENSE](LICENSE).

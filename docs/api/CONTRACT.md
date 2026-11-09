# CONTRACT — canonical Scrolller client API (v1)

This is the single source of truth. **Every operation here MUST exist with identical semantics in all four surfaces:**
`scrolller-core` (TypeScript) · `scrolller-cli` (CLI commands) · `scrolller-mcp` (MCP tools) · `scrolller-py` (Python, sync + async).

Operation matrix: §6. Ground-truth protocol details: `docs/api/RESEARCH.md`.

## 1. Transport (all implementations)

- `POST https://api.scrolller.com/admin`, `Content-Type: application/json`, `Accept: */*`.
- Body: `{"query": <GraphQL document>, "variables": {...}, "authorization": <token|null>}` — token is a **body field**, not a header.
- Default User-Agent: a realistic browser UA. **Configurable** (see §3). Extra custom headers: supported.
- Retries: no automatic retries for mutations; idempotent reads may retry once on 5xx/network error (configurable).
- Timeout: default 30s (configurable).
- All list-style queries paginate via opaque string `iterator` (pass previous response's `iterator`; first page → `null`).
- NSFW: every read operation takes `nsfw: "SFW" | "NSFW" | "ALL"`; **default `SFW` everywhere** (site parity, safe default).

## 2. Client surface (core libraries)

Constructor options (TS `new ScrolllerClient(options)`, Python `ScrolllerClient(**options)`):

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `token` | `string \| null` | `null` | auth token; overrides config file |
| `nsfw` | `"SFW" \| "NSFW" \| "ALL"` | `"SFW"` | default content filter |
| `userAgent` | `string` | bundled realistic UA | override User-Agent |
| `extraHeaders` | `Record<string,string>` | `{}` | extra HTTP headers |
| `proxy` | `ProxyConfig \| null` | `null` | see §4 |
| `timeoutMs` | `number` | `30000` | request timeout |
| `baseUrl` | `string` | `https://api.scrolller.com/admin` | override endpoint (advanced) |
| `configPath` | `string` | auto (§3) | config file location override |

Config file values are defaults; explicit constructor/CLI/env values win.

## 3. Config file (shared by CLI & MCP)

Path: `%USERPROFILE%/.config/scrolller/config.json` on Windows, `~/.config/scrolller/config.json` otherwise (XDG-respected).

```json
{
  "token": null,
  "nsfw": "SFW",
  "user_agent": null,
  "extra_headers": {},
  "proxy": { "type": "http|https|socks4|socks5", "host": "...", "port": 1080, "username": null, "password": null },
  "download_dir": "~/Downloads/scrolller",
  "timeout_ms": 30000
}
```

Env overrides (read by CLI and MCP): `SCROLLLER_TOKEN`, `SCROLLLER_NSFW`, `SCROLLLER_USER_AGENT`, `SCROLLLER_EXTRA_HEADERS` (JSON), `SCROLLLER_PROXY` (`type://[user:pass@]host:port` URL form), `SCROLLLER_DOWNLOAD_DIR`.

## 4. Proxy support (parity in all surfaces)

`ProxyConfig = { type: "http"|"https"|"socks4"|"socks5", host: string, port: number, username?: string, password?: string }`.

- TypeScript core: `undici` `ProxyAgent` for http/https; SOCKS via `socks` package custom undici connector.
- Python: `httpx` with `httpx[socks]`.
- Proxy applies to GraphQL API calls AND media downloads.
- MCP tools `configure_proxy` / `clear_proxy` persist to config (§6); CLI `scrolller proxy` wizard does the same interactively (test-connection included).

## 5. Errors (normalized across surfaces)

`ScrolllerError` base with subclasses/`kind`: `AUTH_REQUIRED`, `INVALID_TOKEN`, `GRAPHQL_ERROR` (message + extensions.code from API), `RATE_LIMITED`, `NETWORK_ERROR`, `PROXY_ERROR`, `NOT_FOUND`, `DOWNLOAD_ERROR`. HTTP status + GraphQL errors[] preserved. CLI prints human message (exit code 1); MCP returns `isError` with message; libraries throw.

## 6. Operation matrix

Legend: 🔓 public (no auth) · 🔒 requires token. CLI column = command; MCP column = tool name; both 1:1 with core method.

| # | Operation | core method | CLI | MCP | Auth | Status |
| --- | --- | --- | --- | --- | --- | --- |
| — | — *FILLED FROM T1 REPORT — operations below are provisional names pending SDL confirmation* | — | — | — | — | — |
| 1 | Discover feed | `discover(opts)` | `scrolller discover` | `discover` | 🔓 | planned |
| 2 | Search media | `search(query, opts)` | `scrolller search <q>` | `search_media` | 🔓 | planned |
| 3 | Subreddit feed | `subredditFeed(name, opts)` | `scrolller subreddit <name>` | `subreddit_feed` | 🔓 | planned |
| 4 | Subreddit autocomplete | `subredditSearch(q)` | `scrolller subreddit-search <q>` | `search_subreddits` | 🔓 | planned |
| 5 | Post by URL/id | `getPost(ref)` | `scrolller post <url>` | `get_post` | 🔓 | planned |
| 6 | Post comments | `getComments(ref)` | `scrolller comments <url>` | `read_comments` | 🔓 | planned |
| 7 | Add comment | `addComment(ref, text)` | `scrolller comment <url> <text>` | `add_comment` | 🔒 | planned |
| 8 | Like / unlike | `like(ref)` / `unlike(ref)` | `scrolller like/unlike <url>` | `like_post` / `unlike_post` | 🔒 | planned |
| 9 | Repost / unrepost | `repost(ref)` / `unrepost(ref)` | `scrolller repost/unrepost` | `repost_post` / `unrepost_post` | 🔒 | planned |
| 10 | Follow subreddit/user | `follow(target)` / `unfollow(target)` | `scrolller follow/unfollow` | `follow` / `unfollow` | 🔒 | planned |
| 11 | Collections list | `collections()` | `scrolller collection list` | `list_collections` | 🔒 | planned |
| 12 | Collection by id | `collection(id)` | `scrolller collection get <id>` | `get_collection` | 🔒 | planned |
| 13 | Create collection | `createCollection(name)` | `scrolller collection create <name>` | `create_collection` | 🔒 | planned |
| 14 | Add/remove to collection | `collectionAdd/Remove(...)` | `scrolller collection add/remove` | `add_to_collection` / `remove_from_collection` | 🔒 | planned |
| 15 | Logged-in user | `me()` | `scrolller whoami` | `whoami` | 🔒 | planned |
| 16 | Login (token) | `setToken(token)` | `scrolller login --token` | `set_token` | — | planned |
| 17 | Notifications | `notifications(opts)` | `scrolller notifications` | `get_notifications` | 🔒 | planned |
| 18 | Messages | `conversations()`, `messages(conv)`, `sendMessage(conv, text)` | `scrolller messages ...` | `get_conversations` / `get_messages` / `send_message` | 🔒 | planned |
| 19 | User profile & posts | `user(name)`, `userPosts(name)` | `scrolller user <name>` | `get_user` / `get_user_posts` | 🔓 | planned |
| 20 | Resolve scrolller link | `resolve(url)` | `scrolller resolve <url>` | `resolve_link` | 🔓 | planned |
| 21 | Hide rules / hide content | `hideRules()`, `hide(post)` | `scrolller hide ...` | `get_hide_rules` / `hide_post` | 🔒 | planned |
| 22 | Download media | `download(post, dir)` | `scrolller download ...` | `download_media` | 🔓 | planned |
| 23 | Proxy config | `setProxy(cfg)` | `scrolller proxy` (wizard) | `configure_proxy` / `clear_proxy` | — | planned |
| 24 | Config get/set | `getConfig()`, `updateConfig(patch)` | `scrolller config get/set` | `get_config` / `update_config` | — | planned |

> ⚠️ Rows marked *planned* become *confirmed* only after T1 SDL extraction maps them to real server operations; operations the server does not support will be **removed** (not stubbed) and documented in README.

## 7. Download semantics (all surfaces)

- Input: post ref (scrolller URL, redditPath, or post object). Output: files in `download_dir`.
- Pick largest `mediaSources` entry; videos: prefer `fullLengthSource`; audio sidecar fetched when present and merged only if ffmpeg available (otherwise save alongside with `.audio` suffix + warning).
- Filename: `<postId>-<slug or subreddit>-<WxH>.<ext>`; collisions → numeric suffix. No overwrite by default.
- Progress: CLI shows progress bar; MCP `download_media` returns saved path(s); library exposes `onProgress` callback (TS) / `progress_callback` (Python).
- Concurrency: `download` of N items uses default 4 parallel workers (configurable).

## 8. Parity acceptance (T4–T7)

An operation is DONE only when: core method implemented + CLI command + MCP tool + (for ops in matrix) Python method — all smoke-tested against the live API (or honestly marked `auth-unverified` where a token is required).

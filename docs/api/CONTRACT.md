# CONTRACT — canonical Scrolller client API (v1)

This is the single source of truth. **Every operation here MUST exist with identical semantics in all four surfaces:**
`scrolller-core` (TypeScript) · `scrolller-cli` (CLI commands) · `scrolller-mcp` (MCP tools) · `scrolller-py` (Python, sync + async).

Operation matrix: §6. **Ground-truth protocol details: `docs/api/T1-RESEARCH-FULL.md` (authoritative)**; `docs/api/RESEARCH.md` is a historical snapshot of the live-probing phase.

## 1. Transport (all implementations)

- `POST https://api.scrolller.com/admin`, `Content-Type: application/json`, `Accept: */*`.
- Body: `{"query": <GraphQL document>, "variables": {...}, "authorization": <token|null>}` — token is a **body field**, not a header.
- Default User-Agent: a realistic browser UA. **Configurable** (see §3). Extra custom headers: supported.
- Retries: no automatic retries for mutations; idempotent reads may retry once on 5xx/network error (configurable).
- Timeout: default 30s (configurable).
- All list-style queries paginate via opaque string `iterator` (pass previous response's `iterator`; first page → `null`).
- NSFW: every read operation takes `nsfw: "SFW" | "NSFW" | "ALL"`; **default `SFW` everywhere** (site parity, safe default).
- ⚠️ **Null-variable trap [verified]**: nullable list variables (`$filter`, `$includeFilters`, `$excludeFilters`) MUST be **omitted** from `variables` when unused — sending explicit `null` → HTTP 200 `INTERNAL_SERVER_ERROR`. `$iterator: null` is fine. All transports drop undefined/null optional filter variables automatically.
- Enums [bundle-verified]: `GallerySortBy = RANDOM | TOP | HOT | NEW | CONTROVERSIAL`; `GalleryFilter = CATEGORY | SUBREDDIT | ALBUM | VIDEO | PICTURE | SOUND` (site UI maps: Photos=PICTURE, Videos=VIDEO, Videos with Sound=SOUND→VIDEO swap server-side); `NsfwFilter = SFW | NSFW | ALL`. Default sortBy on most feeds: RANDOM.
- Search-family queries (`searchSubreddits`, `searchCollections`, `searchUsers`, `searchSubredditWithPreview`) paginate by **`pageIndex` (offset)**, not iterator. Comments paginate by `pagination: {limit, cursor}` where cursor = last comment id. Notifications/messages use numeric `page`. Full per-query table: `docs/api/T1-RESEARCH-FULL.md` §6.
- ⚠️ `iterator` strings are opaque and MUST be passed back **byte-exact** (including the merged following-iterator `"A++B"` and subreddit-children `"x;y"` formats). Never parse, trim or re-encode them.
- ⚠️ Comment list queries (`getComments`, `getRepliesFromComment`) return **plain arrays** (no `{items}` wrapper) — page when `length < limit`.
- Browser token storage (for manual token extraction in README): `localStorage["SCROLLLER_BETA_1:SCROLLLER_LOGIN_DEV"]` — JSON with token + expiry.

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

`ScrolllerError` base with subclasses/`kind`: `AUTH_REQUIRED`, `INVALID_CREDENTIALS`, `INVALID_TOKEN`, `GRAPHQL_ERROR` (message + extensions.code from API), `RATE_LIMITED`, `NETWORK_ERROR`, `PROXY_ERROR`, `NOT_FOUND`, `DOWNLOAD_ERROR`. HTTP status + GraphQL errors[] preserved. CLI prints human message (exit code 1); MCP returns `isError` with message; libraries throw.

### 5.1 Auth-required UX (binding for all surfaces)

The client **knows which operations require auth** (matrix §6). For a 🔒 operation without a token, fail **fast** (before any network call) with `AUTH_REQUIRED`. Server-side auth errors map to the same kind as a backstop.

- **Python**: raises `ScrolllerAuthRequiredError` with message: `Authentication required. Call client.login(username, password), pass token to ScrolllerClient(token=...), or run: scrolller login / scrolller token <token>`
- **CLI**: prints `Not authenticated. Run "scrolller login" (interactive) or "scrolller token <token>"` → exit code 1.
- **MCP**: tool result `isError: true` with the same guidance text (agents can then call the `login` tool).

`INVALID_CREDENTIALS` is mapped from the server message `"Username or password is incorrect"` (server returns generic `INTERNAL_SERVER_ERROR` code — match by message, see RESEARCH.md §3a).

Server-side **token rejections** (`UNAUTHENTICATED`/`FORBIDDEN` codes) map to `INVALID_TOKEN` (more informative than a generic auth error); `AUTH_REQUIRED` is reserved for the client-side fail-fast (🔒 operation attempted with no token) and "login required"-style server messages.

## 6. Operation matrix

Legend: 🔓 public (no auth) · 🔒 requires token. CLI column = command; MCP column = tool name; both 1:1 with core method.

| # | Operation | core method | CLI | MCP | Auth | Status |
| --- | --- | --- | --- | --- | --- | --- |
| — | — *FILLED FROM T1 REPORT — operations below are provisional names pending SDL confirmation* | — | — | — | — | — |
| 1 | Discover feed | `discover(opts)` | `scrolller discover` | `discover` | 🔓 | implemented |
| 2 | Search subreddits (+WIT previews) [server has NO per-post media search] | `searchSubreddits(query, opts)` (searchSubredditWithPreview) | `scrolller search <q>` | `search_media` | 🔓 | implemented |
| 3 | Subreddit feed | `subredditFeed(name, opts)` | `scrolller subreddit <name>` | `subreddit_feed` | 🔓 | implemented |
| 4 | Subreddit autocomplete | `subredditSearch(q)` | `scrolller subreddit-search <q>` | `search_subreddits` | 🔓 | implemented |
| 5 | Post by URL/id | `getPost(ref)` | `scrolller post <url>` | `get_post` | 🔓 | implemented |
| 6 | Post comments [SDL-confirmed] | `getComments(ref, opts)` → `getComments(post_id, pagination{limit,cursor})`; replies via `getRepliesFromComment`; fields incl. `likes_count`, `replies_count`, `is_liked`, `user_account` | `scrolller comments <url>` | `read_comments` | 🔓 | confirmed |
| 7 | Add comment [SDL-confirmed] | `addComment(ref, text)` → `createComment(content, post_id)`; replies `createCommentReply(content, parent_comment_id)`; also like/unlike/delete comment | `scrolller comment <url> <text>` (+ `comment-reply`, `comment-like`, `comment-delete`) | `add_comment` (+ `reply_comment`, `like_comment`, `delete_comment`) | 🔒 | confirmed |
| 8 | Like / unlike [SDL-confirmed] | `like(ref)` / `unlike(ref)` → `addFavorite(url)` / `removeFavorite(url)` | `scrolller like/unlike <url>` | `like_post` / `unlike_post` | 🔒 | confirmed |
| 9 | Repost / unrepost [SDL-confirmed] | `repost(ref)` / `unrepost(ref)` → `repostPost(url)` / `removeRepost(url)` | `scrolller repost/unrepost` | `repost_post` / `unrepost_post` | 🔒 | confirmed |
| 10 | Follow subreddit/user [SDL-confirmed] | `follow(url)` / `unfollow(url)` (works for both `/r/...` and user URLs) | `scrolller follow/unfollow` | `follow` / `unfollow` | 🔒 | confirmed |
| 11 | Collections list | `collections()` | `scrolller collection list` | `list_collections` | 🔒 | implemented |
| 12 | Collection by id | `collection(id)` | `scrolller collection get <id>` | `get_collection` | 🔒 | implemented |
| 13 | Create collection | `createCollection(name)` | `scrolller collection create <name>` | `create_collection` | 🔒 | implemented |
| 14 | Add/remove to collection | `collectionAdd/Remove(...)` | `scrolller collection add/remove` | `add_to_collection` / `remove_from_collection` | 🔒 | implemented |
| 15 | Logged-in user | `me()` | `scrolller whoami` | `whoami` | 🔒 | implemented |
| 16a | Login with credentials [verified] | `login(username, password)` → `{token, expiresAt, username, isPremium}`; persists token+expiry to config | `scrolller login` (interactive prompts; `scrolller login <user> <pass>` for non-interactive) | `login` | 🔓 | verified-shape |
| 16b | Set token manually | `setToken(token)` (persists) | `scrolller token <token>` | `set_token` | — | implemented |
| 16c | Logout (clear token from config) | `logout()` | `scrolller logout` | `logout` | — | implemented |
| 17 | Notifications | `notifications(opts)` | `scrolller notifications` | `get_notifications` | 🔒 | implemented |
| 18 | Messages | `conversations()`, `messages(conv)`, `sendMessage(conv, text)` | `scrolller messages ...` | `get_conversations` / `get_messages` / `send_message` | 🔒 | implemented |
| 19 | User posts | `getUserPosts(name)`, `getRedditUserPosts(name)` (no separate profile method; `whoami` for self) | `scrolller user <name>` | `get_user` / `get_user_posts` | 🔓 | implemented |
| 20 | Resolve scrolller link | `resolve(url)` | `scrolller resolve <url>` | `resolve_link` | 🔓 | implemented |
| 21 | Hide rules / hide content | `hideRules()`, `hide(post)` | `scrolller hide ...` | `get_hide_rules` / `hide_post` | 🔒 | implemented |
| 22 | Download media | `download(post, dir)` | `scrolller download ...` | `download_media` | 🔓 | implemented |
| 23 | Proxy config | `setProxy(cfg)` | `scrolller proxy` (wizard) | `configure_proxy` / `clear_proxy` | — | implemented |
| 24 | Config get/set | `getConfig()`, `updateConfig(patch)` | `scrolller config get/set` | `get_config` / `update_config` | — | implemented |
| 25 | ~~Leaderboard~~ | — | — | — | — | **NOT implementable**: page exists in UI but no GraphQL SDL in the web build (T1) — documented in README |
| 26 | ~~Register account~~ | — | — | — | — | **NOT implementable**: `registerUser` requires reCAPTCHA v2 server-side (also forgetPassword, payments, phone/email verification). Documented in README; users register on the site, then `scrolller login`. |
| 27 | Report post/comment/user [SDL-confirmed] | `report(ref, reason, details?)` → `reportPost(postId,...)` / `reportComment` / `reportUser` / `reportCollection` | `scrolller report <url>` | `report_post` | 🔒 | confirmed |
| 28 | Related posts ("More like this") | `related(ref)` | `scrolller related <url>` | `get_related` | 🔓 | provisional (SDL from T1) |
| 29 | Media-type/category filters on feeds [SDL+UI-verified] | opts on discover/search: `filter` (PICTURE/VIDEO/SOUND), categories via `includeFilters`/`excludeFilters` (omit when unused — null trap), hidden-content | `--photos --videos --with-sound --category` | same params | 🔓 | confirmed |
| 30 | Official agent routes (embed-safe, no raw media) [verified] | `agentSubreddit(slug)`, `agentContent(slug)`, `agentCollection(id)` | `scrolller agent <subreddit\|content\|collection>` | `agent_*` | 🔓 | verified |

> ⚠️ Rows marked *planned* become *confirmed* only after T1 SDL extraction maps them to real server operations; operations the server does not support will be **removed** (not stubbed) and documented in README.

## 7. Download semantics (all surfaces)

- Input: post ref (scrolller URL, redditPath, or post object). Output: files in `download_dir`.
- **Download URLs come ONLY from post-level `mediaSources[]`**: videos = the MP4/WEBM entry with the largest area; images = the largest entry. `fullLengthSource` / `gfycatSource` / `redgifsSource` are reference **page** links (gfycat/redgifs web pages) — NEVER download from them. No separate audio URL exists (audio is inside mp4/webm; `hasAudio` is client-detected metadata).
- Filename: `<postId>-<slug or subreddit>-<WxH>.<ext>`; collisions → numeric suffix. No overwrite by default.
- Progress: CLI shows progress bar; MCP `download_media` returns saved path(s); library exposes `onProgress` callback (TS) / `progress_callback` (Python).
- Concurrency: `download` of N items uses default 4 parallel workers (configurable).

## 8. Parity acceptance (T4–T7)

An operation is DONE only when: core method implemented + CLI command + MCP tool + (for ops in matrix) Python method — all smoke-tested against the live API (or honestly marked `auth-unverified` where a token is required).

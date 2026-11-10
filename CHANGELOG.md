# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/) · SemVer.

## [0.1.0] — 2026-11-10

Initial release.

### Added
- **scrolller-core** (TypeScript): transport (POST `api.scrolller.com/admin`, body auth, null-variable trap handling), config file + env overrides, proxy (http/https/socks4/socks5 via undici+socks), normalized errors, resumable media downloads (mediaSources-only rule, exclusive file create, progress), full operation layer — discover/search/subreddits/posts/comments CRUD/likes/reposts/follow/collections CRUD/hide rules/reports/notifications/messages/login/profile/subscriptions/creator reports/upload/official agent routes, pagination generators (byte-exact cursors), login token+expiry persistence, AUTH_REQUIRED fail-fast.
- **scrolller-cli**: full command tree mirroring the client, colored ASCII banner, `donate` with crypto addresses, interactive `login`, `proxy` wizard with connection test, `--json`/`--no-banner`/`--nsfw`/custom User-Agent & headers, bulk downloads with progress.
- **scrolller-mcp**: stdio MCP server exposing all operations as tools (discover … update_config), auth-hinting error results, proxy/config tools for agents.
- **scrolller-py** (Python 3.9+): sync + async client mirroring the same surface, httpx[socks], 74+ unit tests, live smoke.
- Docs: bilingual README (EN/RU), canonical CONTRACT, full protocol reference (T1-RESEARCH-FULL), CI (Node 22/24, Python 3.9/3.13, Windows job).

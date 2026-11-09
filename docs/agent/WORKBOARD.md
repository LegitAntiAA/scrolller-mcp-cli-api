# WORKBOARD — scrolller-mcp-cli-api

Owner: Root. Statuses: BACKLOG / READY / IN_PROGRESS / IN_REVIEW / IN_TESTING / BLOCKED / DONE.

| ID | Task | Owner | Depends on | Status | Acceptance |
| --- | --- | --- | --- | --- | --- |
| T1 | Реверс JS scrolller.com → полное описание API (эндпоинты, все GraphQL-операции, auth, медиа-URL, пагинация) | Explore agent | — | IN_PROGRESS | `docs/api/RESEARCH.md` со всеми операциями (дословный SDL из бандлов) |
| T2 | Каркас репо (git init, workspaces, py, CI, docs/agent, LICENSE) | Root | — | IN_PROGRESS | Коммит-скелет собирается, `npm install` проходит |
| T3 | Контракт API: `docs/api/CONTRACT.md` — канонический интерфейс клиента + маппинг операций | Root (Architect) | T1 | READY | Контракт покрывает 100% операций из T1; CLI/MCP/Python строятся только по нему |
| T4 | TS core-клиент `packages/core` (вкл. прокси undici+socks, конфиг) | Engineer 1 | T3 | READY | `npm run build` зелёный; 100% операций контракта; smoke-тест реального API |
| T5 | CLI `packages/cli` (баннер, донат, `proxy`-визард, паритет с контрактом) | Engineer 2 | T4 | READY | Реальные команды на ВСЕ операции контракта; `--no-banner`, `--json`; proxy-визард с тестом |
| T6 | MCP-сервер `packages/mcp` (инструменты = контракт, вкл. `configure_proxy`, `set_token`) | Engineer 2 | T4 | READY | Все инструменты контракта; stdio; реальный JSON-RPC handshake |
| T7 | Python-либа `python/` (sync+async, прокси httpx[socks]) | Engineer 3 | T3 | READY | Mirror контракта 1:1, smoke-тест реального API |
| T8 | README (полный, с донатом), CI добить, CHANGELOG | Root | T4–T7 | BACKLOG | README покрывает установку/использование всех трёх частей; секция 💖 Donate с кошельками |
| T9 | Верификация: реальные запросы, CLI e2e, MCP handshake, pytest | QA / User Tester | T5–T7 | BACKLOG | Отчёт Passed/Failed/Skipped по реальному API; без авторизации — честно помечено |

## Блокеры / риски
- Авторизационные операции (лайки, комментарии, коллекции) нельзя верифицировать без реального аккаунта — помечаем как implemented-unverified.
- Контент: сайт SFW+NSFW; NSFW фильтры — опциональный флаг, по умолчанию выкл.

## Кошельки доната (канон — README + `packages/cli/src/donate.ts`)
BTC `bc1qw4my95y7uhmg7up7w762qfju04l6960plpkp0u` · ETH `0x9a3e38ffa8d0002e8423a101b98ef214a574abde` · USDT ERC-20 `0x9a3e38ffa8d0002e8423a101b98ef214a574abde` · USDT TRC-20 `TNGrTqLZZdf99zTQoSABvXmAzPTh7NfESk` · TON `UQBwZJojKzuIFCpf4V_RSVCSub4J96IWulnfeJ-hYRviB3nw`

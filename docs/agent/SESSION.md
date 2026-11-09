# SESSION — 2026-11-10

Цель: репозиторий `scrolller-mcp-cli-api` — MCP-сервер + CLI + API-клиенты (TS, Python) для Scrolller; подготовка к публикации на GitHub.

Сделано:
- Скачаны 37 JS-бандлов scrolller.com → `tmp/scrolller-js/` (вне репо, не коммитится).
- Подтверждён эндпоинт `https://api.scrolller.com/api/v2/graphql`; собран список имен GraphQL-операций.
- Каркас репо: git init (main), workspaces core/cli/mcp, python/, CI, docs/agent, LICENSE MIT.

Активно:
- Explore-агент: полный реверс бандлов (T1).
- Root: каркас (T2), затем контракт (T3) и раскраска задач инженерам.

Дальше: T3 → Engineer 1 (core, T4) → Engineer 2 (CLI T5, MCP T6) ∥ Engineer 3 (Python T7) → QA (T9) → Reviewer → README/публикация (T8).

Ограничения: auth-операции без реального аккаунта не верифицируются.

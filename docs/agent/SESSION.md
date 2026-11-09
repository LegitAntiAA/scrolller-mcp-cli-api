# SESSION — 2026-11-10

Цель: репозиторий `scrolller-mcp-cli-api` — MCP-сервер + CLI + API-клиенты (TS, Python) для Scrolller; подготовка к публикации на GitHub.

Сделано:
- Скачаны 37 JS-бандлов scrolller.com → `tmp/scrolller-js/` (вне репо, не коммитится).
- **Реальный эндпоинт подтверждён живьём**: POST https://api.scrolller.com/admin, тело {query, variables, authorization}; /api/v2/graphql из бандла — 404 (ложный след).
- NsfwFilter = SFW|NSFW|ALL подтверждён; пагинация iterator работает; интроспекция закрыта (Apollo).
- docs/api/RESEARCH.md (проверенные факты) + docs/api/CONTRACT.md (канон; §1–5,7 готовы, матрица операций provisional).
- Каркас + CLI-баннер (ANSI-градиент) + `scrolller donate` с кошельками. Коммиты: 619324c, 543be06, 5b2e816, 045a3e2.

Активно (субагенты):
- Explore (T1): SDL-каталог всех операций + auth-флоу (получил от Root приоритезацию).
- Engineer 1 (T4-ф1): TS core транспорт — УПАЛ от concurrency limit, возобновить при свободном слоте (SendMessage, task T4-phase1).
- Engineer 3 (T7-ф1): Python транспорт — работает.

Дальше: T1 → фаза 2 (операции) в core/python ∥ Engineer 2 (CLI-команды T5, MCP T6) → QA (T9) → README EN+RU (T8) → публикация.

Ограничения: auth-операции без реального аккаунта не верифицируются; concurrency субагентов ограничен — не держать >2 фоновых агентов.

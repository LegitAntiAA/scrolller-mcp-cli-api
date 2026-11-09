# DECISIONS — scrolller-mcp-cli-api

| # | Решение | Обоснование |
| --- | --- | --- |
| D1 | Монорепа npm workspaces: `packages/core`, `packages/cli`, `packages/mcp` + `python/` | Один репозиторий под все 3 продукта; независимая публикация пакетов; общие типы через workspace-зависимость |
| D2 | TS: ESM-only, NodeNext, ES2022, strict | Современный стандарт, нативный fetch, MCP SDK совместим |
| D3 | Node >= 18, core без runtime-зависимостей (нативный fetch/streams) | Минимум зависимостей = меньше рисков поставки |
| D4 | CLI: `commander`; `--no-banner` и запрет баннера в `--json`/non-TTY | Баннер не ломает скрипты и пайпы |
| D5 | Python: httpx, sync + async зеркало контракта, stdlib dataclasses | Единый контракт; без pydantic-зависимости |
| D6 | MCP: официальный `@modelcontextprotocol/sdk`, stdio | Стандарт экосистемы |
| D7 | Донат: секция в README + `scrolller donate` + цветные ссылки в баннере; канонические адреса в `packages/cli/src/donate.ts` и README | Требование пользователя; один источник в коде, дубль в README |
| D8 | NSFW-контент: по умолчанию фильтры сайта (SFW), включение NSFW — явная опция (`--nsfw` / `nsfw=True` / MCP-параметр) | Сайт общий, NSFW опционален (указание пользователя) |
| D9 | Unofficial-дисклеймер в README; реверс только для клиентского API | Честная публикация на GitHub |

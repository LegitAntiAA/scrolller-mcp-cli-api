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
| D10 | Полный паритет: каждая операция контракта реализована во ВСЕХ трёх поверхностях (core-TS, CLI-команда, MCP-инструмент) и в Python | Требование пользователя; контракт = единый источник |
| D11 | Прокси: типы http/https/socks4/socks5. TS: undici ProxyAgent + socks-коннектор (`undici`, `socks`). Python: `httpx[socks]` | Покрыть все популярные типы прокси |
| D12 | Общий конфиг `~/.config/scrolller/config.json` (token, proxy, nsfw, download_dir) — читается CLI и MCP | Единое хранилище настроек |
| D13 | CLI `scrolller proxy` — интерактивный визард с тестом подключения; MCP-инструменты `configure_proxy` + `set_token` (перманентно в конфиг) | Требование пользователя: агент должен уметь «установи прокси и залогинься» |
| D14 | Авторизация: если сайт допускает логин по кредам — реализуем `login(email, password)`; иначе честный fallback `set_token` (токен из браузера) | Зависит от результата реверса (T1) |
| D15 | README ×2: `README.md` (EN) + `README.ru.md` (RU), кросс-ссылки; установка, Features (функции + все MCP-инструменты), подключение MCP в Cursor / Claude Desktop / Codex | Требование пользователя |
| D16 | Настраиваемый User-Agent + кастомные заголовки (config.json: `user_agent`, `extra_headers`; CLI `--user-agent`/`--header`; env `SCROLLLER_USER_AGENT`, `SCROLLLER_EXTRA_HEADERS`) | Обход простых бот-фильтров; гибкость для продвинутых пользователей |

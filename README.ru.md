<div align="center">

# scrolller-mcp-cli-api

**«3 в 1» для [Scrolller](https://scrolller.com)** (неофициально): 🤖 MCP-сервер для ИИ-агентов · ⌨️ CLI для терминала · 📚 API-библиотеки (TypeScript + Python)

[English README](README.md) · [Донат 💖](#-донат)

</div>

---

На Scrolller и обычный (SFW), и NSFW-контент — **NSFW везде опционален** (по умолчанию `SFW`).

> ⚠️ **Неофициальный проект.** Не связан со Scrolller. Создан реверс-инжинирингом публичного веб-клиента сайта ([описание протокола](docs/api/T1-RESEARCH-FULL.md)). Для действий с авторизацией нужен **ваш собственный** аккаунт Scrolller. Уважайте правила сайта (уместен темп ~1 запрос/сек), возрастные рейтинги и местные законы. Часть категорий — 18+.

## Возможности

- 🔍 **Ленты** — тренды/рандом, сортировка (`random / top / hot / new / controversial`), фильтры по типу медиа (фото / видео / видео со звуком), категории
- 🔎 **Поиск** — сабреддиты (с превью), пользователи
- 📄 **Посты** — метаданные, выбор лучшего источника медиа, альбомы, похожие посты («More like this»)
- 💬 **Комментарии** — чтение (с ответами), написание, ответы, лайки, удаление, жалобы
- ❤️ **Лайки и репосты**, 👥 **подписки** на сабреддиты и пользователей, ленты подписок
- 📁 **Коллекции** — создание/редактирование/удаление, добавление постов, платные коллекции
- 🔐 **Авторизация** — `login(логин|email, пароль)` сохраняет токен (+срок); можно вставить токен вручную
- 🔔 **Уведомления** и ✉️ **сообщения** (диалоги, переписки, отправка, счётчик непрочитанных)
- 📤 **Загрузка** контента / создание постов (с авторизацией), 📊 отчёты креатора (только чтение)
- ⬇️ **Скачивание** — видео (MP4/WEBM) и картинки в оригинальном качестве, массово по запросу, параллельно, с прогрессом, без перезаписи файлов
- 🌐 **Официальные агентские роуты** — embed-безопасный JSON (`/agent/*`, без сырых медиа-ссылок)
- 🛡️ **Прокси** — `http / https / socks4 / socks5` (socks4 — через Node-клиент), интерактивный визард, переменные окружения и флаги
- ⚙️ **Общий конфиг** — один `config.json` + переменные окружения для CLI и MCP; кастомный **User-Agent** и доп. заголовки
- 🔞 **NSFW — осознанный выбор** — `SFW` (по умолчанию) / `NSFW` / `ALL` в каждой операции чтения

## Установка

Нужен **Node.js ≥ 22.19** (CLI + MCP + TS-библиотека).

### Вариант 1 — установка с GitHub (работает уже сейчас)

```bash
git clone https://github.com/LegitAntiAA/scrolller-mcp-cli-api
cd scrolller-mcp-cli-api

npm ci && npm run build          # собрать все Node-пакеты

npm link -w scrolller-cli        # теперь `scrolller` работает в любом терминале
npm link -w scrolller-mcp        # теперь `scrolller-mcp` работает (его запускает MCP-клиент)

scrolller --help                 # 🎉
```

`npm link` создаёт глобальные команды, указывающие на локальную сборку, — после `git pull` просто повтори `npm run build`. Python-библиотека опциональна:

```bash
pip install -e python            # Python ≥ 3.9 (для тестов — "python[dev]")
```

### Вариант 2 — установка из реестра npm (после публикации)

`npm install -g scrolller-cli` скачивает пакет из **реестра npm**, а не с GitHub — эти команды заработают после публикации пакетов там:

```bash
npm install -g scrolller-cli     # CLI
npm install -g scrolller-mcp     # MCP-сервер
npm install scrolller-core       # TypeScript-библиотека
pip install scrolller-py         # Python-библиотека (Python ≥ 3.9)
```

## CLI — краткий курс

```bash
scrolller discover --limit 10               # лента трендов
scrolller discover --sort top --videos      # фильтры: --photos --videos --with-sound --sort
scrolller search "burger" --limit 20        # поиск сабреддитов
scrolller subreddit aww --limit 30          # лента сабреддита
scrolller post <ссылка-на-пост>             # детали поста
scrolller comments <ссылка-на-пост>         # чтение комментариев

# скачивание
scrolller download <ссылка-на-пост>         # один пост, оригинальное качество
scrolller download "burger" -n 10 -o ./dl   # 10 штук по запросу
scrolller download <ссылка> -c 8            # 8 параллельных потоков

# авторизация (нужна для лайков/комментариев/коллекций и т.д.)
scrolller login                             # интерактивно: логин + пароль
scrolller token <токен>                     # или вставить токен вручную
scrolller whoami

# действия с авторизацией
scrolller like <ссылка-на-пост>
scrolller comment <ссылка-на-пост> "круто!"
scrolller collection create "Мой пак"
scrolller collection add <id-коллекции> <ссылка-на-пост>

# разное
scrolller agent subreddit carporn           # официальный embed-роут
scrolller proxy                             # визард прокси (с тестом подключения)
scrolller config get --json
scrolller donate                            # 💖 криптокошельки
```

Глобальные флаги: `--json` (машинный вывод, без баннера), `--no-banner`, `--nsfw NSFW`, `--user-agent <ua>`, `--header "K: V"` (можно несколько), `--proxy <url>`, `--timeout <ms>`.

## TypeScript-библиотека

```ts
import { ScrolllerClient } from "scrolller-core";

const client = new ScrolllerClient();

// генератор страниц (курсоры обрабатываются автоматически)
for await (const page of client.discoverPages({ limit: 10, nsfw: "SFW" })) {
  for (const sub of page.items) console.log(sub.title);
}

const post = await client.getPost("https://scrolller.com/пост-abc123");
await client.download(post, "./out");            // оригинальное качество
await client.login("username", "password");      // токен сохранится в конфиг
await client.like("https://scrolller.com/пост-abc123");
await client.addComment("https://scrolller.com/пост-abc123", "круто!");
```

## Python-библиотека

```python
from scrolller import ScrolllerClient

client = ScrolllerClient()                # асинхронный: AsyncScrolllerClient

for page in client.discover_pages(limit=10):
    for sub in page.items:
        print(sub.title)

post = client.get_post("https://scrolller.com/пост-abc123")
client.download(post, "./out")
client.login("username", "password")      # токен сохранится
client.like("https://scrolller.com/пост-abc123")
```

## MCP-сервер

Всё, что умеет CLI, доступно как MCP-**инструменты** (`scrolller-mcp`, stdio): `discover`, `search_media`, `subreddit_feed`, `search_subreddits`, `get_post`, `read_comments`, `add_comment`, `reply_comment`, `like_comment`, `delete_comment`, `like_post`, `unlike_post`, `repost_post`, `unrepost_post`, `follow`, `unfollow`, `list_collections`, `get_collection`, `create_collection`, `add_to_collection`, `remove_from_collection`, `edit_collection`, `delete_collection`, `whoami`, `login`, `set_token`, `logout`, `get_notifications`, `mark_notifications`, `get_conversations`, `get_messages`, `send_message`, `get_user`, `resolve_link`, `get_related`, `hide_post`, `unhide_post`, `get_hide_rules`, `report_post`, `download_media`, `agent_subreddit`, `agent_content`, `agent_collection`, `configure_proxy`, `clear_proxy`, `get_config`, `update_config`.

### Claude Desktop

`Claude Desktop → Settings → Developer → Edit Config` (файл `claude_desktop_config.json`):

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

Cursor → `Settings → MCP & Integrations → MCP Tools → New MCP Server`, либо правьте `~/.cursor/mcp.json`:

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

### Переменные окружения (работают и в CLI, и в MCP)

`SCROLLLER_TOKEN`, `SCROLLLER_NSFW`, `SCROLLLER_USER_AGENT`, `SCROLLLER_EXTRA_HEADERS` (JSON), `SCROLLLER_PROXY` (`тип://[юзер:пароль@]хост:порт`), `SCROLLLER_DOWNLOAD_DIR`.

### Пример сессии с агентом

Скажите агенту:

> «Вот мой прокси (хост, порт, тип) — настрой его в Scrolller и залогинься с моими учётными данными, потом найди и скачай 10 видео по запросу *бургер*, первым пяти поставь лайк, а самому первому напиши комментарий *круто*».

Агент сделает ровно это: `configure_proxy` → `login` → `search_media`/`download_media` ×10 → `like_post` ×5 → `add_comment`. Инструменты, требующие авторизации, возвращают подсказку сначала вызвать `login`/`set_token` — агент сам исправится.

## Конфигурация

Общий конфиг: `%USERPROFILE%/.config/scrolller/config.json` (Windows) / `~/.config/scrolller/config.json`:

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

Приоритет: явная опция → окружение → файл конфига → дефолты. Токен хранится **открытым текстом** (на POSIX файл chmod 600) — обращайтесь как с паролем.

**Токен вручную**: залогиньтесь на scrolller.com в браузере, затем скопируйте токен из DevTools → Application → Local Storage → `SCROLLLER_BETA_1:SCROLLLER_LOGIN_DEV`.

## Примечания и ограничения

- **Честная оговорка**: операции с авторизацией (лайки, комментарии, коллекции, сообщения и т.д.) реализованы по верифицированным GraphQL-шейпам сайта, но **не проверялись вживую с реальным аккаунтом** в процессе разработки — публичные (без токена) операции полностью проверены живьём.
- У сайта в текущей веб-сборке **нет GraphQL для leaderboard / поиска коллекций / глобального поиска постов** (у страницы лидерборда нет публичного API), поэтому они не реализованы; поиск коллекций покрывает официальный роут `/agent/collection/{id}`.
- `register`, сброс пароля и платежи на сервере **защищены капчей** — аккаунты создаёте на сайте, дальше `scrolller login`.
- У `searchCollections` нет публичного GraphQL-документа в текущей сборке сайта (работает официальный роут `/agent/collection/{id}`).
- Звук живёт внутри MP4/WEBM — отдельных аудиодорожек нет.
- Рейт-лимиты на IP; для агентских роутов держите ~1 запрос/сек и будьте аккуратны с GraphQL-эндпоинтом.
- `socks4` поддерживается Node-клиентом; Python-клиент — `http/https/socks5`.

## Структура репозитория

```
packages/core    → scrolller-core  (TypeScript-клиент: транспорт + все операции)
packages/cli     → scrolller-cli   (терминальный CLI, цветной ASCII-баннер)
packages/mcp     → scrolller-mcp   (MCP-сервер, stdio)
python/          → scrolller-py    (Python-клиент: sync + async)
docs/api         → CONTRACT (каноническая поверхность) + T1-RESEARCH-FULL (протокол)
```

## 💖 Донат

Если проект сэкономил вам время — поддержите разработку:

| Валюта | Адрес |
| --- | --- |
| **BTC** | `bc1qw4my95y7uhmg7up7w762qfju04l6960plpkp0u` |
| **Ethereum (ETH)** | `0x9a3e38ffa8d0002e8423a101b98ef214a574abde` |
| **USDT (ERC-20)** | `0x9a3e38ffa8d0002e8423a101b98ef214a574abde` |
| **USDT (TRC-20)** | `TNGrTqLZZdf99zTQoSABvXmAzPTh7NfESk` |
| **TON** | `UQBwZJojKzuIFCpf4V_RSVCSub4J96IWulnfeJ-hYRviB3nw` |

В CLI: `scrolller donate` — красиво и цветом. Спасибо! 🙏

## Лицензия

MIT — см. [LICENSE](LICENSE).

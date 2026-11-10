# BUGS — scrolller-mcp-cli-api

Источник: независимое ревью (T10) + живые проверки. Severity: CRITICAL / HIGH / MEDIUM / LOW.

| ID | Summary | Severity | Component | Root cause / evidence | Status |
| --- | --- | --- | --- | --- | --- |
| BUG-1 | `fullLengthSource` трактовался как медиафайл → скачивался HTML вместо видео | HIGH | download (TS+PY), CONTRACT §7 | T1-RESEARCH-FULL §3/§5: это ссылки на страницы gfycat/redgifs. Ревью F1 (эмпир.) | FIXED (docs+PY в работе; TS — в фазе 2) |
| BUG-2 | Явный `null` в `$filter` → HTTP 200 INTERNAL_SERVER_ERROR | HIGH | transport | Server 500-trap, верифицирован живьём; ревью F2 | FIXED TS (omitNullVariables); PY в работе |
| BUG-3 | socks4 в Python падает raw ValueError + течёт пароль прокси в тексте исключения | HIGH | python _proxy/_transport | httpx поддерживает socks5 only; ревью F3 (эмпир.) | IN_PROGRESS (Engineer 3) |
| BUG-4 | `--no-banner` не скрывал баннер | MEDIUM | cli index.ts | Флаг не входил в showBanner; ревью F4 (эмпир.) | FIXED (проверено) |
| BUG-5 | 3xx от медиа-хостов → файл 0 байт без ошибки | MEDIUM | python _download | follow_redirects=False на shared-клиенте; ревью F5 (эмпир.) | IN_PROGRESS (Engineer 3) |
| BUG-6 | Гонка `_resolve_path` в ThreadPool → перезапись файлов | MEDIUM | python _download | TOCTOU между выбором имени и созданием; ревью F6 (эмпир.) | IN_PROGRESS (Engineer 3) |
| BUG-7 | config.json с токеном/паролем без ограничения прав (POSIX 0644) | MEDIUM | python _config | Нет chmod; ревью F7 | IN_PROGRESS (Engineer 3) |
| BUG-8 | Нет close()/aclose()/context-manager у клиентов | MEDIUM | python client | Ревью F8 | IN_PROGRESS (Engineer 3) |
| BUG-9 | engines `>=18` врал (commander≥20, undici≥22.19) | MEDIUM | scaffold | npm ls engine check; ревью F9 | FIXED (>=22.19, CI 22/24) |
| BUG-10 | RESEARCH.md протух против T1 (енумы, хосты, аудио, регистрация) | MEDIUM | docs | Ревью F10 | FIXED (помечен историческим снапшотом) |
| BUG-11 | Bare `scrolller` → exit 1; `--version` печатал баннер | LOW | cli index.ts | commander default; ревью F19 (эмпир.) | FIXED (exit 0, баннер скрыт) |
| BUG-12 | CI: npm install вместо npm ci; нет Windows-джобы | LOW | .github/workflows | Ревью F18/F21 | FIXED |
| BUG-13 | P3-набор ревью (F12–F17, F20: тесты, kwarg, IPv6, cleanup) | LOW | python | Ревью | IN_PROGRESS (Engineer 3) |

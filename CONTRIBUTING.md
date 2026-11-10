# Contributing

Thanks for your interest! Quick rules to keep this maintainable:

## Ground rules

1. **The contract is canonical** — `docs/api/CONTRACT.md` defines the client surface shared by all four implementations (core-TS, CLI, MCP, Python). Any operation change starts there.
2. **Protocol truth** — GraphQL documents must match `docs/api/T1-RESEARCH-FULL.md` verbatim. Don't invent fields; the server rejects unknown ones.
3. **Parity** — an operation isn't done until it exists in all surfaces with the same name/semantics.
4. **NSFW is opt-in** — every read operation defaults to `SFW`. Don't change that.
5. **Be gentle** — no built-in retries for mutations, keep default pacing, never bypass rate limits.

## Dev setup

```bash
git clone <repo> && cd scrolller-mcp-cli-api
npm ci && npm run build       # Node workspaces (core, cli, mcp)
npm test --workspaces         # unit tests (node:test)
npm run smoke -w scrolller-core   # live API smoke

cd python && pip install -e ".[dev]"
python -m pytest tests -q         # unit tests
python -m scrolller.smoke         # live API smoke
```

## Commit style

Conventional-ish, imperative: `feat(cli): …`, `fix(core): …`, `docs: …`. One logical change per commit.

## Reporting bugs

Open an issue with: what you ran, expected vs actual, the `kind` of any `ScrolllerError` (or CLI output), and whether a proxy/NSFW/token was involved. **Never paste your token or credentials.**

## License

By contributing you agree your contributions are licensed under the MIT license.

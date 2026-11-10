# scrolller-core

TypeScript API client for [Scrolller](https://scrolller.com) (unofficial) — the engine behind
[scrolller-cli](../cli) and [scrolller-mcp](../mcp).

Full documentation, CLI, MCP server and the Python client: **[root README](../../README.md)**.

```ts
import { ScrolllerClient } from "scrolller-core";

const client = new ScrolllerClient();
for await (const page of client.discoverPages({ limit: 10 })) {
  for (const sub of page.items) console.log(sub.title);
}
```

Requires Node ≥ 22.19. NSFW content is opt-in (default `SFW`).

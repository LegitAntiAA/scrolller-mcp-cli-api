#!/usr/bin/env node
/** scrolller MCP server (stdio) — exposes the full core operation surface
 * (docs/api/CONTRACT.md §6 MCP column) to AI agents. ONE ScrolllerClient per
 * process; SCROLLLER_* env vars and the shared config file apply (CONTRACT §3).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRequire } from "node:module";
import { closeClient, createClient } from "./client.js";
import { registerTools } from "./tools.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

async function main(): Promise<void> {
  const client = createClient();
  const server = new McpServer({ name: "scrolller", version }, { capabilities: { tools: {} } });
  registerTools(server, client);

  const transport = new StdioServerTransport();
  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    await closeClient(client);
    process.exit(0);
  };
  transport.onclose = () => {
    void shutdown();
  };
  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });

  await server.connect(transport);
}

await main().catch((error: unknown) => {
  console.error("scrolller-mcp: fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});

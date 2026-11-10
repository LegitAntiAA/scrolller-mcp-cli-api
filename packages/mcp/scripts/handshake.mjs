#!/usr/bin/env node
/** Real JSON-RPC handshake against the built MCP server over stdio (no extra deps):
 * initialize -> initialized -> tools/list -> call `discover` {limit:2} ->
 * call `whoami` (expect an AUTH_REQUIRED error result). Exit 0 = all green.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));

// Isolated config so `whoami` deterministically hits the auth fail-fast and the
// user's real token/config is never touched.
const configDir = path.join(tmpdir(), `scrolller-mcp-handshake-${process.pid}`);
mkdirSync(configDir, { recursive: true });
const configPath = path.join(configDir, "config.json");
writeFileSync(configPath, `${JSON.stringify({ token: null, nsfw: "SFW" })}\n`, "utf8");

const child = spawn(process.execPath, [serverPath], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, SCROLLLER_CONFIG_PATH: configPath },
});

let buffer = "";
const pending = new Map(); // id -> resolve
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let newlineIndex;
  while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      console.error(`handshake: unparseable server output: ${error.message}`);
      continue;
    }
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  }
});
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  process.stderr.write(`server stderr: ${chunk}`);
});

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function request(id, method, params) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for response to ${method}`)), 60000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    send({ jsonrpc: "2.0", id, method, params });
  });
}

let exitCode = 0;
try {
  const init = await request(1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "scrolller-handshake", version: "0.0.0" },
  });
  if (init.error) throw new Error(`initialize failed: ${JSON.stringify(init.error)}`);
  console.log(`initialize ok: server=${JSON.stringify(init.result?.serverInfo)}, protocol=${init.result?.protocolVersion}`);
  send({ jsonrpc: "2.0", method: "notifications/initialized" });

  const listed = await request(2, "tools/list", {});
  const tools = listed.result?.tools ?? [];
  console.log(`tools/list ok: ${tools.length} tools`);
  if (tools.length === 0) throw new Error("tools/list returned no tools");

  const discovered = await request(3, "tools/call", { name: "discover", arguments: { limit: 2 } });
  if (discovered.error) throw new Error(`discover call failed: ${JSON.stringify(discovered.error)}`);
  if (discovered.result?.isError) throw new Error(`discover returned an error result: ${discovered.result?.content?.[0]?.text ?? "?"}`);
  const feed = JSON.parse(discovered.result?.content?.[0]?.text ?? "{}");
  console.log(`discover ok: ${feed.items?.length ?? 0} subreddit cards (iterator=${feed.iterator ? "present" : "null"})`);
  if ((feed.items?.length ?? 0) !== 2) throw new Error(`expected 2 discover cards, got ${feed.items?.length ?? 0}`);

  const whoami = await request(4, "tools/call", { name: "whoami", arguments: {} });
  if (whoami.error) throw new Error(`whoami call failed: ${JSON.stringify(whoami.error)}`);
  const whoamiPayload = whoami.result?.content?.[0]?.text ?? "{}";
  const parsed = JSON.parse(whoamiPayload);
  const authError = whoami.result?.isError === true && parsed?.error?.kind === "AUTH_REQUIRED";
  if (!authError) throw new Error(`expected whoami to fail with AUTH_REQUIRED, got: ${whoamiPayload}`);
  console.log(`whoami ok (expected auth error): kind=AUTH_REQUIRED hint present=${Boolean(parsed.error.hint)}`);

  console.log("HANDSHAKE PASSED");
} catch (error) {
  console.error(`HANDSHAKE FAILED: ${error.message}`);
  exitCode = 1;
} finally {
  child.kill();
}
process.exit(exitCode);

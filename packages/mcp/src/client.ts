/** MCP client factory — ONE ScrolllerClient per server process (CONTRACT.md §3).
 *
 * Configuration: SCROLLLER_* environment variables and the config file are
 * resolved by the core (defaults <- config file <- environment). An explicit
 * constructor input would win over both, so the server passes none except an
 * optional SCROLLLER_CONFIG_PATH override (useful for tests/isolated runs).
 */
import { ScrolllerClient } from "scrolller-core";

export function createClient(): ScrolllerClient {
  const configPathRaw = process.env["SCROLLLER_CONFIG_PATH"];
  const configPath = configPathRaw && configPathRaw.trim() ? configPathRaw : undefined;
  return new ScrolllerClient({ configPath });
}

/** Release the underlying undici dispatcher (clean shutdown). */
export async function closeClient(client: ScrolllerClient): Promise<void> {
  try {
    await client.dispatcher.close();
  } catch {
    // dispatcher may already be closed; shutdown must not throw
  }
}

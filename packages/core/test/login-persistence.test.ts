/** Unit test for login persistence (CONTRACT.md row 16a): LoginQuery result
 * {token, expiresAt} is persisted to the config file; logout clears both.
 * Uses a MOCK transport (request shadowed on the instance) — no network.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ScrolllerClient } from "../src/index.js";

type MockRequest = (
  query: string,
  variables?: Record<string, unknown> | null,
  options?: { token?: string | null },
) => Promise<unknown>;

interface CapturedCall {
  query: string;
  variables: Record<string, unknown> | null | undefined;
  options: { token?: string | null } | undefined;
}

const LOGIN_PAYLOAD = {
  username: "tester",
  token: "tok-abc-123",
  expiresAt: 1900000000, // epoch seconds (T1 §2)
  isAdmin: false,
  deleted_at: null,
  isPremium: false,
};

function makeMockedClient(): { client: ScrolllerClient; calls: CapturedCall[]; configPath: string } {
  const configPath = path.join(mkdtempSync(path.join(tmpdir(), "scrolller-login-test-")), "config.json");
  const client = new ScrolllerClient({ configPath });
  const calls: CapturedCall[] = [];
  (client as unknown as { request: MockRequest }).request = async (query, variables, options) => {
    calls.push({ query, variables, options });
    if (query.includes("query LoginQuery")) return { login: LOGIN_PAYLOAD };
    return {};
  };
  return { client, calls, configPath };
}

test("login returns the account info and persists token + expires_at to the config file", async () => {
  const { client, calls, configPath } = makeMockedClient();
  assert.equal(client.hasToken(), false);

  const result = await client.login("tester", "hunter2");
  assert.equal(result.username, "tester");
  assert.equal(result.token, "tok-abc-123");
  assert.equal(result.expiresAt, 1900000000);
  assert.equal(client.hasToken(), true);

  // The login body is anonymous ("authorization": null) like the site (T1 §1).
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.query, /query LoginQuery/);
  assert.deepEqual(calls[0]!.variables, { username: "tester", password: "hunter2" });
  assert.equal(calls[0]!.options?.token, null);

  const fileData = JSON.parse(readFileSync(configPath, "utf8"));
  assert.equal(fileData.token, "tok-abc-123");
  assert.equal(fileData.expires_at, 1900000000);
});

test("logout clears both token and expires_at from the config file", async () => {
  const { client, configPath } = makeMockedClient();
  await client.login("tester", "hunter2");
  assert.equal(client.hasToken(), true);

  client.logout();
  assert.equal(client.hasToken(), false);
  const fileData = JSON.parse(readFileSync(configPath, "utf8"));
  assert.equal(fileData.token, null);
  assert.equal(fileData.expires_at, null);
});

test("a login response without a token does not overwrite the configured token", async () => {
  const configPath = path.join(mkdtempSync(path.join(tmpdir(), "scrolller-login-test-")), "config.json");
  const client = new ScrolllerClient({ configPath, token: "pre-set" });
  (client as unknown as { request: MockRequest }).request = async () => ({ login: { username: "x", token: null } });
  await client.login("x", "y");
  assert.equal(client.hasToken(), true);
  // Nothing was persisted: the config file was never even created.
  assert.equal(existsSync(configPath), false);
});

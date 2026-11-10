/** Unit tests for operation-level variable shapes (mock transport, no network):
 * - subredditChildren passes cursors through BYTE-EXACT (CONTRACT.md §1)
 * - searchUsers pageIndex defaults (offset pagination, T1 §6)
 * - discover leaves unset nullable filter variables undefined so the transport
 *   omits them from the payload (null-variable trap, CONTRACT.md §1)
 */
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ScrolllerClient } from "../src/index.js";

type MockRequest = (
  query: string,
  variables?: Record<string, unknown> | null,
  options?: { token?: string | null },
) => Promise<unknown>;

function makeMockedClient(responseFor: (query: string) => unknown): { client: ScrolllerClient; calls: Array<{ query: string; variables: Record<string, unknown> | null | undefined }> } {
  const client = new ScrolllerClient({ configPath: path.join(tmpdir(), "scrolller-op-vars-does-not-write.json") });
  const calls: Array<{ query: string; variables: Record<string, unknown> | null | undefined }> = [];
  (client as unknown as { request: MockRequest }).request = async (query, variables) => {
    calls.push({ query, variables });
    return responseFor(query);
  };
  return { client, calls };
}

test("subredditChildren continues a feed page byte-exact ('x;y' iterator untouched)", async () => {
  const iterator = "764925172;2147432983";
  const { client, calls } = makeMockedClient(() => ({ getSubredditChildren: { iterator: null, items: [] } }));
  const feed = {
    iterator,
    items: [],
    subreddit: { id: 42, title: "aww" },
  };
  await client.subredditChildren(feed);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.query, /query SubredditChildrenQuery/);
  assert.equal(calls[0]!.variables?.subredditId, 42);
  assert.equal(calls[0]!.variables?.iterator, iterator); // byte-exact, no trim/re-encode
});

test("subredditChildren accepts a numeric subreddit id and an explicit iterator", async () => {
  const { client, calls } = makeMockedClient(() => ({ getSubredditChildren: { iterator: null, items: [] } }));
  await client.subredditChildren(7, { iterator: "x;y", limit: 10 });
  assert.equal(calls[0]!.variables?.subredditId, 7);
  assert.equal(calls[0]!.variables?.iterator, "x;y");
  assert.equal(calls[0]!.variables?.limit, 10);
  assert.equal(calls[0]!.variables?.nsfw, "SFW");
});

test("searchUsers sends query/limit/pageIndex with pageIndex defaulting to 0", async () => {
  const { client, calls } = makeMockedClient(() => ({ searchUsers: [] }));
  await client.searchUsers("car");
  assert.match(calls[0]!.query, /query SearchUsersQuery/);
  assert.deepEqual(calls[0]!.variables, { query: "car", limit: 20, pageIndex: 0 });
});

test("discover leaves unset nullable filter variables undefined (transport drops them)", async () => {
  const { client, calls } = makeMockedClient(() => ({ discoverFilteredSubreddits: { iterator: null, items: [] } }));
  await client.discover({ limit: 2, childLimit: 2 });
  const variables = calls[0]!.variables!;
  assert.equal(variables.limit, 2);
  assert.equal(variables.childLimit, 2);
  assert.equal(variables.nsfw, "SFW"); // client default (CONTRACT.md §1)
  assert.equal(variables.sortBy, undefined);
  assert.equal(variables.filter, undefined);
  assert.equal(variables.includeFilters, undefined);
  assert.equal(variables.excludeFilters, undefined);
  assert.equal(variables.iterator, undefined);
});

test("discover passes a resume iterator byte-exact", async () => {
  const { client, calls } = makeMockedClient(() => ({ discoverFilteredSubreddits: { iterator: null, items: [] } }));
  await client.discover({ limit: 2, childLimit: 2, iterator: "2977", sortBy: "HOT" });
  assert.equal(calls[0]!.variables?.iterator, "2977");
  assert.equal(calls[0]!.variables?.sortBy, "HOT");
});

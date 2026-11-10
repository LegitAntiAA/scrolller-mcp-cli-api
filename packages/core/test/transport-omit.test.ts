/** Unit tests for omitNullVariables — the null-variable-trap payload behavior
 * (CONTRACT.md §1: nullable filter variables MUST be omitted, explicit null →
 * HTTP 200 INTERNAL_SERVER_ERROR, live-verified).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { omitNullVariables } from "../src/transport.js";

test("drops undefined and null entries at the top level", () => {
  const cleaned = omitNullVariables({
    limit: 2,
    iterator: null,
    nsfw: "SFW",
    filter: undefined,
    includeFilters: [],
    excludeFilters: null,
    sortBy: "HOT",
    childLimit: 2,
  });
  assert.deepEqual(cleaned, { limit: 2, nsfw: "SFW", includeFilters: [], sortBy: "HOT", childLimit: 2 });
});

test("keeps falsy-but-meaningful values: false, 0, empty string, empty array, empty object", () => {
  const cleaned = omitNullVariables({ flag: false, zero: 0, empty: "", list: [], obj: {} });
  assert.deepEqual(cleaned, { flag: false, zero: 0, empty: "", list: [], obj: {} });
});

test("keeps nested objects untouched (including nested nulls — callers must avoid them)", () => {
  const cleaned = omitNullVariables({ data: { a: 1, b: null } });
  assert.deepEqual(cleaned, { data: { a: 1, b: null } });
});

test("returns a new object and does not mutate the input", () => {
  const input = { a: 1, b: null as string | null };
  const cleaned = omitNullVariables(input);
  assert.deepEqual(Object.keys(input).sort(), ["a", "b"]);
  assert.deepEqual(Object.keys(cleaned), ["a"]);
});

test("empty input yields an empty object", () => {
  assert.deepEqual(omitNullVariables({}), {});
});

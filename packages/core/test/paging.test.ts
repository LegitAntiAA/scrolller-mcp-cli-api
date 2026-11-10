/** Unit tests for pagination primitives — in particular the BYTE-EXACT cursor
 * pass-through required by CONTRACT.md §1 ("A++B" merged iterators, "x;y"
 * subreddit-children iterators — never parse/trim/re-encode).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isExhaustedCursor,
  iteratedPages,
  listFromPages,
  pagedByIndex,
  pagedByLastId,
  pagedByPageNumber,
} from "../src/paging.js";

test("isExhaustedCursor: null/undefined/empty/literal-'null' signal exhaustion, real cursors do not", () => {
  for (const exhausted of [null, undefined, "", "null"]) {
    assert.equal(isExhaustedCursor(exhausted), true, String(exhausted));
  }
  for (const live of ["A++B", "x;y", "2977", "764925172;2147432983", "0"]) {
    assert.equal(isExhaustedCursor(live), false, String(live));
  }
});

test("iteratedPages passes cursors back byte-exact (null → 'A++B' → 'x;y')", async () => {
  const pages = [
    { iterator: "A++B", items: [1] },
    { iterator: "x;y", items: [2] },
    { iterator: "764925172;2147432983", items: [3] },
    { iterator: null, items: [4] },
  ];
  const seenCursors: Array<string | null> = [];
  const seenItems: number[] = [];
  for await (const page of iteratedPages<number>(async (cursor) => {
    seenCursors.push(cursor);
    const next = pages[seenCursors.length - 1];
    if (!next) throw new Error("unexpected extra fetch");
    return next;
  })) {
    seenItems.push(...page.items);
  }
  assert.deepEqual(seenCursors, [null, "A++B", "x;y", "764925172;2147432983"]);
  assert.equal(seenCursors[1], "A++B");
  assert.equal(seenCursors[2], "x;y");
  assert.deepEqual(seenItems, [1, 2, 3, 4]);
});

test("iteratedPages stops without fetching again when the response iterator is 'null'/'' (string)", async () => {
  let fetches = 0;
  const gen = iteratedPages<number>(async (cursor) => {
    fetches += 1;
    return { iterator: cursor === null ? "null" : "", items: [1] };
  });
  const pages = [];
  for await (const page of gen) pages.push(page);
  assert.equal(fetches, 1);
  assert.equal(pages.length, 1);
});

test("iteratedPages resumes from a caller-supplied initial cursor byte-exact", async () => {
  const seen: Array<string | null> = [];
  const gen = iteratedPages<number>(async (cursor) => {
    seen.push(cursor);
    return { iterator: null, items: [] };
  }, "A++B");
  for await (const page of gen) void page;
  assert.deepEqual(seen, ["A++B"]);
});

test("pagedByLastId pages comments by last comment id and stops on a short page", async () => {
  const seenCursors: Array<number | null> = [];
  const pages: Array<Array<{ id: number }>> = [
    Array.from({ length: 5 }, (_, i) => ({ id: i + 1 })),
    Array.from({ length: 5 }, (_, i) => ({ id: i + 6 })),
    [{ id: 11 }],
  ];
  const collected: number[] = [];
  for await (const page of pagedByLastId<{ id: number }>(async (cursor) => {
    seenCursors.push(cursor);
    const next = pages[seenCursors.length - 1];
    if (!next) throw new Error("unexpected extra fetch");
    return next;
  }, 5)) {
    collected.push(...page.map((c) => c.id));
  }
  assert.deepEqual(seenCursors, [null, 5, 10]);
  assert.deepEqual(collected, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test("pagedByIndex auto-increments pageIndex and stops on a short page", async () => {
  const seen: number[] = [];
  const collected: number[] = [];
  for await (const page of pagedByIndex<number>(async (pageIndex) => {
    seen.push(pageIndex);
    return pageIndex < 2 ? [pageIndex * 10, pageIndex * 10 + 1] : [20];
  }, 2)) {
    collected.push(...page);
  }
  assert.deepEqual(seen, [0, 1, 2]);
  assert.deepEqual(collected, [0, 1, 10, 11, 20]);
});

test("pagedByPageNumber increments numeric pages and stops on a short page", async () => {
  const seen: number[] = [];
  const collected: number[] = [];
  for await (const page of pagedByPageNumber<number>(async (page) => {
    seen.push(page);
    return page < 3 ? [1, 2, 3] : [7];
  }, 3, 1)) {
    collected.push(...page);
  }
  assert.deepEqual(seen, [1, 2, 3]);
  assert.deepEqual(collected, [1, 2, 3, 1, 2, 3, 7]);
});

test("listFromPages collects up to the given limit across pages", async () => {
  async function* pages() {
    yield [1, 2];
    yield [3, 4];
    yield [5];
  }
  assert.deepEqual(await listFromPages(pages(), 3), [1, 2, 3]);
  assert.deepEqual(await listFromPages(pages(), null), [1, 2, 3, 4, 5]);
  assert.deepEqual(await listFromPages(pages()), [1, 2, 3, 4, 5]);
});

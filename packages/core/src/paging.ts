/** Pagination primitives for the operation methods (CONTRACT.md §1, T1 §6).
 *
 * - Iterator feeds: the response `iterator` is opaque and passed back
 *   BYTE-EXACT — never parsed, trimmed or re-encoded (covers the merged
 *   following-iterator "A++B" and subreddit-children "x;y" formats).
 * - Search family: numeric `pageIndex` (offset) auto-increment.
 * - Comments: plain-array responses paged by cursor = last comment id; stop
 *   when the returned array is shorter than the requested limit.
 */
import { isNumericId } from "./op-utils.js";

/**
 * Decide whether a response cursor means "no more pages".
 *
 * - null/undefined: normal exhaustion.
 * - "" : empty cursor (the site also uses "" as a START cursor for
 *   getPostsByCreators — as a RESPONSE value it carries no position, so treat
 *   it as exhausted to avoid loops).
 * - "null": the merged following-feed iterators use the literal string "null"
 *   for exhausted parts (T1 §6).
 */
export function isExhaustedCursor(iterator: unknown): boolean {
  return iterator === null || iterator === undefined || iterator === "" || iterator === "null";
}

export interface IteratedPage<T> {
  iterator: string | null;
  items: T[];
}

/** Async generator over iterator-paginated pages; the cursor is forwarded verbatim.
 * `initialCursor` resumes a caller-supplied cursor (byte-exact) instead of starting at null. */
export async function* iteratedPages<T>(
  fetchPage: (iterator: string | null) => Promise<IteratedPage<T>>,
  initialCursor: string | null = null,
): AsyncGenerator<IteratedPage<T>> {
  let cursor: string | null = initialCursor;
  for (;;) {
    const page = await fetchPage(cursor);
    yield page;
    if (isExhaustedCursor(page.iterator)) return;
    cursor = page.iterator;
  }
}

/** Async generator over pageIndex (offset) paginated searches; stops on a
 * short page (fewer than `pageSize` items) or an empty one. */
export async function* pagedByIndex<T>(
  fetchPage: (pageIndex: number) => Promise<T[]>,
  pageSize: number,
): AsyncGenerator<T[]> {
  let pageIndex = 0;
  for (;;) {
    const items = await fetchPage(pageIndex);
    yield items;
    if (items.length < pageSize) return;
    pageIndex += 1;
  }
}

/** Async generator over plain-array comment pages; cursor = last comment id
 * (numeric), stop when a page is shorter than the requested limit (T1 §3e). */
export async function* pagedByLastId<T extends { id?: number | string | null }>(
  fetchPage: (cursor: number | null) => Promise<T[]>,
  pageSize: number,
): AsyncGenerator<T[]> {
  let cursor: number | null = null;
  for (;;) {
    const items = await fetchPage(cursor);
    yield items;
    if (items.length === 0 || items.length < pageSize) return;
    const lastId = items[items.length - 1]?.id;
    const parsed = typeof lastId === "number" ? lastId : typeof lastId === "string" && isNumericId(lastId) ? Number(lastId) : NaN;
    if (!Number.isInteger(parsed)) return;
    cursor = parsed;
  }
}

/** Async generator over numeric `page` paginated arrays; stops on a short/empty page. */
export async function* pagedByPageNumber<T>(
  fetchPage: (page: number) => Promise<T[]>,
  pageSize: number,
  firstPage = 1,
): AsyncGenerator<T[]> {
  let page = firstPage;
  for (;;) {
    const items = await fetchPage(page);
    yield items;
    if (items.length === 0 || items.length < pageSize) return;
    page += 1;
  }
}

/** Flatten an async page generator into an array, stopping once `limit` items
 * were collected (list* one-shot helpers). `limit` null/undefined = read all. */
export async function listFromPages<T>(pages: AsyncGenerator<T[]>, limit?: number | null): Promise<T[]> {
  const out: T[] = [];
  for await (const page of pages) {
    out.push(...page);
    if (limit != null && out.length >= limit) {
      return limit >= 0 ? out.slice(0, limit) : out;
    }
  }
  return out;
}

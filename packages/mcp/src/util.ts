/** Shared MCP helpers: compact JSON results, error mapping (CONTRACT.md §5/§5.1),
 * post-ref resolution, and the download-by-query collector.
 */
import {
  bestMediaSource,
  isNumericId,
  NotFoundError,
  ScrolllerError,
  type PostResult,
  type ScrolllerClient,
} from "scrolller-core";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// ---------------------------------------------------------------------------
// Result shaping
// ---------------------------------------------------------------------------

/** Trim huge media arrays: `mediaSources` keeps only the best entry and
 * `blurredMediaSources` is dropped — unless `verbose`. */
export function compact(value: unknown, verbose: boolean): unknown {
  if (verbose) return value;
  const seen = new WeakSet<object>();
  function walk(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(walk);
    if (node !== null && typeof node === "object") {
      const record = node as Record<string, unknown>;
      if (seen.has(record)) return "[circular]";
      seen.add(record);
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(record)) {
        if (key === "blurredMediaSources") continue;
        if (key === "mediaSources" && Array.isArray(child) && child.length > 1) {
          out[key] = Array.isArray(record["mediaSources"]) && record["mediaSources"].length > 0 ? [bestMediaSource(record)] : [];
          continue;
        }
        out[key] = walk(child);
      }
      return out;
    }
    return node;
  }
  return walk(value);
}

export function toolJson(value: unknown, verbose = false): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(compact(value, verbose)) }] };
}

// ---------------------------------------------------------------------------
// Errors → isError results (CONTRACT.md §5; auth hint per §5.1)
// ---------------------------------------------------------------------------

const HINTS: Record<string, string> = {
  AUTH_REQUIRED: 'Not authenticated. Call the "login" tool with username/password, or "set_token" with a browser token (localStorage["SCROLLLER_BETA_1:SCROLLLER_LOGIN_DEV"]).',
  INVALID_CREDENTIALS: "Check the username and password; account registration is captcha-gated on scrolller.com and not available via the API.",
  INVALID_TOKEN: "The stored token was rejected — call logout, then login or set_token again.",
  GRAPHQL_ERROR: "Inspect message/extensions; some filters must be omitted rather than null.",
  RATE_LIMITED: "Slow down and retry later (agent routes allow ~1 request/second).",
  NETWORK_ERROR: "Check connectivity/proxy; consider a larger timeout_ms in the config.",
  PROXY_ERROR: "Fix the proxy settings (configure_proxy) or clear them (clear_proxy).",
  NOT_FOUND: "Check that the URL/id/ref exists; resolve_link can validate scrolller links first.",
  DOWNLOAD_ERROR: "Downloads only use post-level mediaSources[] — the post may have no usable media.",
};

export function toolError(error: unknown): CallToolResult {
  let kind = "UNKNOWN";
  let message: string;
  if (error instanceof ScrolllerError) {
    kind = error.kind ?? "SCROLLLER_ERROR";
    message = error.message;
  } else if (error instanceof Error) {
    message = error.message;
  } else {
    message = String(error);
  }
  const hint = HINTS[kind];
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: { kind, message, ...(hint ? { hint } : {}) } }) }],
  };
}

// ---------------------------------------------------------------------------
// Refs / download-by-query (mirrors the CLI; CONTRACT.md §6 rows 5/21/22)
// ---------------------------------------------------------------------------

/** Make a post/subreddit ref absolute: ResolveScrolllerLinks (core resolveLink,
 * used by comments/collections/hide/report id resolution) only accepts full
 * https://scrolller.com/... URLs, while feed post objects carry relative paths
 * like "/corvette-...". No-op for absolute URLs and bare ids. */
export function toAbsoluteScrolllerUrl(value: string): string {
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (value.startsWith("/") && !value.startsWith("//")) return `https://scrolller.com${value}`;
  return value;
}

/** Resolve a bare numeric id, post URL, or redditPath to a numeric post id. */
export async function resolvePostRefToId(client: ScrolllerClient, ref: string | number): Promise<number> {
  if (typeof ref === "number") return ref;
  if (isNumericId(ref)) return Number(ref);
  const link = await client.resolveLink(toAbsoluteScrolllerUrl(ref));
  const id = link?.post?.id;
  const parsed = typeof id === "number" ? id : typeof id === "string" ? Number(id) : NaN;
  if (!Number.isInteger(parsed)) {
    throw new NotFoundError(`cannot resolve a post id from ${JSON.stringify(ref)}`);
  }
  return parsed;
}

/** Collect up to `count` posts for a free-text query: direct subreddit feed
 * first (fast path when the query names a subreddit), then the site search
 * page (SearchSubredditWithPreview) pulling posts from each matching
 * subreddit. No per-query media search exists server-side. */
export async function collectQueryPosts(client: ScrolllerClient, query: string, count: number): Promise<PostResult[]> {
  const posts: PostResult[] = [];
  const seen = new Set<string>();
  const push = (list: PostResult[]): void => {
    for (const post of list) {
      const key = post.url ?? String(post.id ?? posts.length);
      if (seen.has(key)) continue;
      seen.add(key);
      posts.push(post);
    }
  };

  try {
    push(await client.listSubredditPosts(query, { limit: count }));
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error; // not a subreddit name — try the search page
  }
  if (posts.length >= count) return posts.slice(0, count);

  const matches = await client.searchSubredditWithPreview(query, { limit: 10 });
  for (const match of matches) {
    if (posts.length >= count) break;
    if (!match.url) continue;
    // Search-page URLs arrive as "r/name" (no leading slash).
    const subUrl = /^r\//i.test(match.url) ? `/${match.url}` : match.url;
    try {
      push(await client.listSubredditPosts(subUrl, { limit: count - posts.length }));
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error; // skip dead subreddits
    }
  }
  return posts.slice(0, count);
}

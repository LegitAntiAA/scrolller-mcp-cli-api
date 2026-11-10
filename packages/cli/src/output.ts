/** Output helpers: machine JSON (compact, media-trimmed unless -v) and human
 * lists/tables. No external dependencies — fixed-width plain text.
 */
import { bestMediaSource, type CollectionResult, type CommentResult, type MediaSource, type PostResult, type SubredditResult } from "scrolller-core";

// ---------------------------------------------------------------------------
// JSON output (CONTRACT: --json prints the core result; huge media arrays are
// trimmed to the best entry unless --verbose)
// ---------------------------------------------------------------------------

/** Replace each post's `mediaSources` array with just the best entry and drop
 * `blurredMediaSources`; recursive so feeds/search results shrink too. */
export function compactForOutput(value: unknown, verbose: boolean): unknown {
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
          out[key] = recordHasSources(record) ? [bestMediaSource(record)] : [];
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

function recordHasSources(record: Record<string, unknown>): boolean {
  return Array.isArray(record["mediaSources"]) && record["mediaSources"].length > 0;
}

export function printJson(value: unknown, verbose: boolean): void {
  console.log(JSON.stringify(compactForOutput(value, verbose)));
}

// ---------------------------------------------------------------------------
// Small formatting primitives
// ---------------------------------------------------------------------------

/** 1234567 → "1.2M", 12345 → "12.3K". */
export function fmtCount(value: number | string | null | undefined): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "?";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.trunc(n));
}

export function fmtBytes(value: number): string {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)}MiB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)}KiB`;
  return `${value}B`;
}

function truncate(text: string | null | undefined, max = 72): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function nsfwMark(isNsfw: boolean | null | undefined): string {
  return isNsfw ? " NSFW" : "";
}

function oneLine(value: unknown): string {
  return JSON.stringify(value) ?? "?";
}

// ---------------------------------------------------------------------------
// Human formatters
// ---------------------------------------------------------------------------

/** Normalized subreddit-card row shared by discover / search / subreddit-search. */
export interface SubredditCardRow {
  title: string | null;
  url: string | null;
  itemCount: number | string | null;
  subscribers: number | string | null;
  isNsfw: boolean | null;
}

export function printSubredditCards(items: SubredditCardRow[]): void {
  if (items.length === 0) {
    console.log("no results");
    return;
  }
  for (const item of items) {
    const bits = [item.url ?? "?", item.title ?? "?"];
    if (item.itemCount !== null) bits.push(`items=${fmtCount(item.itemCount)}`);
    if (item.subscribers !== null) bits.push(`subs=${fmtCount(item.subscribers)}`);
    console.log(`${bits.join("  ·  ")}${nsfwMark(item.isNsfw)}`);
  }
}

function subredditRow(sub: SubredditResult): SubredditCardRow {
  return { title: sub.title ?? null, url: sub.url ?? null, itemCount: sub.itemCount ?? null, subscribers: sub.subscribers ?? null, isNsfw: sub.isNsfw ?? null };
}

export { subredditRow };

export function printPostListItem(index: number, post: PostResult): void {
  const source = safeBestSource(post);
  const bits = [
    `[${index}] ${truncate(post.title ?? post.reddit_posted_by ?? "(untitled)", 64)}`,
    source ? `${source.width ?? "?"}x${source.height ?? "?"} ${(source.type ?? "").toLowerCase()}` : null,
    post.favoriteCount ? `♥ ${fmtCount(post.favoriteCount)}` : null,
    post.commentsCount ? `💬 ${fmtCount(post.commentsCount)}` : null,
  ].filter((bit): bit is string => bit !== null);
  console.log(bits.join("  ·  "));
  if (post.url) console.log(`    ${post.url}`);
}

export function printPost(post: PostResult): void {
  const lines: Array<[string, string]> = [
    ["title", truncate(post.title ?? "(untitled)", 120)],
    ["id", String(post.id ?? "?")],
    ["url", post.url ?? "?"],
    ["subreddit", post.subredditUrl ?? "?"],
    ["by", post.username ?? post.reddit_posted_by ?? "?"],
    ["created", post.createdAt ?? "?"],
    ["favorites", post.favoriteCount !== undefined && post.favoriteCount !== null ? String(post.favoriteCount) : "?"],
    ["reposts", post.repostCount !== undefined && post.repostCount !== null ? String(post.repostCount) : "?"],
    ["comments", post.commentsCount !== undefined && post.commentsCount !== null ? String(post.commentsCount) : "?"],
    ["nsfw", String(post.isNsfw ?? "?")],
    ["audio", String(post.hasAudio ?? "?")],
  ];
  if (post.duration) lines.push(["duration", post.duration]);
  if (post.tags && post.tags.length > 0) lines.push(["tags", post.tags.join(", ")]);
  const source = safeBestSource(post);
  if (source) {
    lines.push(["best media", `${source.type ?? "?"} ${source.width ?? "?"}x${source.height ?? "?"}`]);
    lines.push(["media url", source.url ?? "?"]);
  }
  for (const [key, value] of lines) console.log(`${key.padEnd(10)} ${value}`);
}

function safeBestSource(post: PostResult): MediaSource | null {
  try {
    return bestMediaSource(post);
  } catch {
    return null;
  }
}

export function printComments(comments: CommentResult[]): void {
  if (comments.length === 0) {
    console.log("no comments");
    return;
  }
  for (const comment of comments) {
    const bits = [
      comment.user_account?.username ?? "?",
      `id=${comment.id ?? "?"}`,
      `♥ ${comment.likes_count ?? 0}`,
      comment.replies_count ? `replies ${comment.replies_count}` : null,
      comment.created_at ?? null,
    ].filter((bit): bit is string => bit !== null);
    console.log(`${bits.join("  ·  ")}`);
    console.log(`    ${truncate(comment.content, 200)}`);
  }
}

export function printKeyValue(title: string, fields: Array<[string, unknown]>): void {
  console.log(title);
  for (const [key, value] of fields) {
    const rendered = value === null || value === undefined ? "-" : typeof value === "object" ? oneLine(value) : String(value);
    console.log(`  ${key.padEnd(16)} ${truncate(rendered, 110)}`);
  }
}

export function printCollection(collection: CollectionResult): void {
  printKeyValue(`collection ${collection.id ?? "?"}`, [
    ["title", collection.title],
    ["url", collection.url],
    ["items", collection.item_count],
    ["private", collection.is_private],
    ["nsfw", collection.is_nsfw],
    ["description", collection.description],
  ]);
}

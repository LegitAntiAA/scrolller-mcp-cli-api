/** Download plumbing for the CLI: single-post and by-query collection plus a
 * dependency-free single-line progress renderer (CONTRACT.md §7).
 */
import { downloadToDir, NotFoundError, type DownloadProgress, type DownloadResult, type PostResult, type ScrolllerClient } from "scrolller-core";
import { fmtBytes } from "./output.js";

// ---------------------------------------------------------------------------
// Progress rendering (TTY + non-JSON only)
// ---------------------------------------------------------------------------

export class ProgressRenderer {
  private readonly enabled: boolean;
  private cleared = true;
  private readonly order = new Map<string, number>();
  private readonly knownTotal: number;

  constructor(enabled: boolean, total: number) {
    this.enabled = enabled && Boolean(process.stdout.isTTY);
    this.knownTotal = total;
  }

  private clear(): void {
    if (!this.cleared) {
      process.stdout.write("\r\x1b[2K");
      this.cleared = true;
    }
  }

  private write(line: string): void {
    process.stdout.write(`\r\x1b[2K${line}`);
    this.cleared = false;
  }

  update(progress: DownloadProgress): void {
    if (!this.enabled || progress.done) return;
    let index = this.order.get(progress.postId);
    if (index === undefined) {
      index = this.order.size;
      this.order.set(progress.postId, index);
    }
    const percent = progress.bytesTotal !== null && progress.bytesTotal > 0
      ? `${((progress.bytesDone / progress.bytesTotal) * 100).toFixed(1)}%`
      : `${fmtBytes(progress.bytesDone)}`;
    const totalText = progress.bytesTotal !== null ? ` / ${fmtBytes(progress.bytesTotal)}` : "";
    const shownTotal = Math.max(this.knownTotal, index + 1);
    this.write(`  [${index + 1}/${shownTotal}] ${progress.postId}: ${percent} ${fmtBytes(progress.bytesDone)}${totalText}`);
  }

  finish(): void {
    if (this.enabled) this.clear();
  }
}

// ---------------------------------------------------------------------------
// Query → posts collection (CONTRACT: `download <query> -n N`)
// ---------------------------------------------------------------------------

/** Collect up to `count` posts for a free-text query: direct subreddit feed
 * first (fast path when the query names a subreddit), then the site search
 * page (SearchSubredditWithPreview) pulling posts from each matching
 * subreddit. No per-query media search exists server-side. */
export async function collectQueryPosts(
  client: ScrolllerClient,
  query: string,
  count: number,
): Promise<PostResult[]> {
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

/** Download posts into `dir`; renders progress when enabled; returns results. */
export async function runDownload(
  client: ScrolllerClient,
  posts: PostResult[],
  dir: string,
  concurrency: number,
  progress: ProgressRenderer,
): Promise<DownloadResult[]> {
  const results = await downloadToDir(posts, dir, {
    concurrency,
    onProgress: (p) => progress.update(p),
  });
  progress.finish();
  return results;
}

export function printDownloadResults(results: DownloadResult[]): void {
  let saved = 0;
  for (const result of results) {
    if (result.error) {
      console.log(`  FAILED ${result.postId}: ${result.error}`);
    } else {
      saved += 1;
      console.log(`  saved ${result.path ?? "?"}`);
    }
  }
  console.log(`Downloaded ${saved}/${results.length} file(s).`);
}

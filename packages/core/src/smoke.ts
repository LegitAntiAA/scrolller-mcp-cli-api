/** Live smoke test for the Scrolller client — T4-phase2 (transport + operations).
 *
 * Usage: `npm run smoke -w scrolller-core`
 *
 * Hits REAL public operations (no auth):
 *   1. discover page 1            (DiscoverFilteredSubredditsQuery)
 *   2. subreddit feed r/aww       (SubredditQuery)
 *   3. searchSubreddits "car"     (SearchSubredditsQuery)
 *   4. getPost for one discovered post (SubredditPostQuery)
 *   5. getComments for that post  (getCommentsQuery — plain array)
 *   6. agentSubreddit("carporn")  (official agent route, plain GET JSON)
 * and verifies an auth op FAILS FAST without a token (like → AuthRequiredError,
 * no authenticated live call is ever made — we have no account token).
 *
 * Prints one short result line per operation. Exits non-zero on any failure.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bestMediaSource } from "./download.js";
import { AuthRequiredError, errorMessage, ScrolllerError } from "./errors.js";
import { ScrolllerClient } from "./index.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function brief(value: unknown, max = 160): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined) return "undefined";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<number> {
  // Anonymous client (default config). Anonymous reads send "authorization":
  // null per T1 §1; NSFW default SFW per CONTRACT.md §1. Timeout and retries
  // are raised for the smoke only: a slow network moment or a connection
  // reset (the edge drops bursts; agent routes document ~1 req/s) must not
  // fail the run. Library defaults stay 30s / 1 retry.
  const client = new ScrolllerClient({ timeoutMs: 60000, readRetries: 2 });

  try {
    // 1. Discover feed (page 1, small).
    const feed = await client.discover({ limit: 2, childLimit: 2, sortBy: "HOT" });
    const firstSub = feed.items[0];
    if (!firstSub) {
      console.error("smoke FAILED: discover returned no subreddit items");
      return 1;
    }
    console.log(`discover: ${feed.items.length} subreddit cards, iterator=${brief(feed.iterator, 40)}, first title=${firstSub.title ?? "?"}`);
    const firstPost = firstSub.children?.items?.[0];
    if (firstPost) {
      const source = bestMediaSource(firstPost);
      console.log(`discover post media: ${brief(source.url, 90)}`);
    }

    // 2. Subreddit feed (r/aww).
    await pause(500); // gentle pacing: the edge resets connection bursts
    const aww = await client.subredditFeed("aww", { limit: 5, sortBy: "HOT" });
    if (!aww.subreddit) {
      console.error("smoke FAILED: subredditFeed returned no subreddit object");
      return 1;
    }
    console.log(`subreddit r/aww: title=${aww.subreddit.title ?? "?"}, posts on page=${aww.items.length}, children iterator=${brief(aww.iterator, 40)}`);

    // 3. Subreddit autocomplete search.
    await pause(500);
    const search = await client.searchSubreddits("car", { limit: 5, pageIndex: 0 });
    if (!Array.isArray(search) || search.length === 0) {
      console.error("smoke FAILED: searchSubreddits returned no results for 'car'");
      return 1;
    }
    console.log(`searchSubreddits "car": ${search.length} results, first=${search[0]?.title ?? "?"} (${search[0]?.url ?? "?"})`);

    // 4. getPost for one post discovered above (uses the API's own post URL).
    let postUrl: string | null = firstPost?.url ?? null;
    if (!postUrl && aww.items[0]?.url) postUrl = aww.items[0].url;
    if (!postUrl) {
      console.error("smoke FAILED: no post URL available from discover/subreddit feeds for getPost");
      return 1;
    }
    const post = await client.getPost(postUrl);
    await pause(500);
    console.log(`getPost: id=${post.id ?? "?"}, title=${brief(post.title ?? post.reddit_posted_by ?? "?", 60)}, mediaSources=${post.mediaSources?.length ?? 0}, hasAudio=${post.hasAudio ?? "?"}`);

    // 5. Comments for that post (plain array; may legitimately be empty).
    await pause(500);
    const postId = typeof post.id === "number" ? post.id : null;
    const comments = postId !== null
      ? await client.getComments(postId, { limit: 5 })
      : await client.getComments(postUrl, { limit: 5 });
    console.log(`getComments: ${comments.length} top-level comments${comments.length > 0 && comments[0] ? `, first by ${comments[0].user_account?.username ?? "?"}` : ""}`);

    // 6. Official agent route (embed-safe, plain GET JSON).
    await pause(1000); // agent routes are rate limited ~1 req/s per IP
    const agent = await client.agentSubreddit("carporn");
    console.log(`agentSubreddit("carporn"): ${brief(agent, 120)}`);

    // 7. Auth fail-fast: a 🔒 op without a token must throw AuthRequiredError
    // BEFORE any network call. Isolated client with a throwaway config file so
    // the user's real config/token is never touched.
    const smokeConfigPath = path.join(mkdtempSync(path.join(tmpdir(), "scrolller-smoke-")), "config.json");
    const anonClient = new ScrolllerClient({ configPath: smokeConfigPath });
    if (anonClient.hasToken()) {
      console.log("auth fail-fast: SKIPPED (a token is present via SCROLLLER_TOKEN env)");
    } else {
      try {
        await anonClient.like("https://scrolller.com/r/aww");
        console.error("smoke FAILED: like() without a token did not throw AuthRequiredError");
        return 1;
      } catch (error) {
        if (error instanceof AuthRequiredError) {
          console.log(`auth fail-fast: like() without token threw AuthRequiredError as required (message: ${brief(error.message, 90)})`);
        } else {
          console.error(`smoke FAILED: expected AuthRequiredError, got: ${errorMessage(error)}`);
          return 1;
        }
      }
    }

    console.log("smoke PASSED (all public operations + auth fail-fast verified against the live API)");
    return 0;
  } catch (error) {
    const kind = error instanceof ScrolllerError && error.kind ? error.kind : "UNKNOWN";
    console.error(`smoke FAILED: [${kind}] ${errorMessage(error)}`);
    return 1;
  }
}

main().then((code) => process.exit(code));

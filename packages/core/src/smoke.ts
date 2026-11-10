/** Live smoke test for the Scrolller transport (T4-phase1).
 *
 * Usage: `npm run smoke -w scrolller-core`
 *
 * Runs the verbatim discover query from RESEARCH.md §3 with limit 2 and prints
 * the page iterator, the first subreddit title and the first post's best media
 * URL. Exits non-zero on any failure.
 */
import { bestMediaSource } from "./download.js";
import { errorMessage, ScrolllerError } from "./errors.js";
import { ScrolllerClient } from "./index.js";

const DISCOVER_QUERY = `\
query DiscoverFilteredSubredditsQuery(
  $filter: GalleryFilter
  $sortBy: GallerySortBy
  $limit: Int!
  $childLimit: Int!
  $iterator: String
  $includeFilters: [Int!]
  $excludeFilters: [Int!]
  $nsfw: NsfwFilter
) {
  discoverFilteredSubreddits(data: {
    nsfw: $nsfw
    filter: $filter
    limit: $limit
    childLimit: $childLimit
    iterator: $iterator
    includeFilters: $includeFilters
    excludeFilters: $excludeFilters
    sortBy: $sortBy
  }) {
    iterator
    recommendationType
    hasV1Recommendations
    hasV2Recommendations
    items {            # subreddit cards
      __typename id url title secondaryTitle description createdAt isNsfw
      subscribers isComplete itemCount videoCount pictureCount albumCount
      isPaid username tags
      banner { url width height isOptimized }
      isFollowing
      moreSubreddits { id url title isPaid isNsfw previewUrl }
      children {       # posts inside the subreddit card
        iterator
        items {        # post/media objects
          __typename id url reddit_posted_by subredditId subredditTitle
          subredditUrl subredditIsFollowing redditPath isNsfw hasAudio
          fullLengthSource gfycatSource redgifsSource ownerAvatar username
          displayName userType favoriteCount repostCount isPaid tags
          commentsCount commentsRepliesCount duration createdAt
          albumContent { mediaSources { url width height isOptimized type } }
          isFavorite isReposted
          mediaSources { url width height isOptimized type }
          blurredMediaSources { url width height isOptimized type }
        }
      }
    }
  }
}`;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function main(): Promise<number> {
  // Site-default variable shape (RESEARCH.md §3). Verified live: nullable
  // $filter/$excludeFilters sent as explicit nulls make the server answer
  // INTERNAL_SERVER_ERROR — omitNullVariables (default true) drops them, and
  // `iterator: null` too (omitted = null; both accepted).
  const variables: Record<string, unknown> = {
    limit: 2,
    iterator: null,
    nsfw: "SFW",
    includeFilters: [],
    sortBy: "HOT",
    childLimit: 2,
  };
  try {
    const client = new ScrolllerClient();
    const data = await client.request(DISCOVER_QUERY, variables);
    const feed = asRecord(asRecord(data)?.discoverFilteredSubreddits) ?? {};
    console.log("iterator:", feed.iterator ?? null);

    const items = Array.isArray(feed.items) ? feed.items : [];
    const first = asRecord(items[0]);
    if (!first) {
      console.error("smoke FAILED: feed returned no subreddit items");
      return 1;
    }
    console.log("first subreddit title:", first.title ?? null);

    const children = asRecord(first.children);
    const posts = children && Array.isArray(children.items) ? children.items : [];
    const post = asRecord(posts[0]);
    if (!post) {
      console.error("smoke FAILED: first subreddit card embeds no posts");
      return 1;
    }
    const source = bestMediaSource(post);
    console.log("first post media URL:", source.url);
    return 0;
  } catch (error) {
    const kind = error instanceof ScrolllerError && error.kind ? error.kind : "UNKNOWN";
    console.error(`smoke FAILED: [${kind}] ${errorMessage(error)}`);
    return 1;
  }
}

main().then((code) => process.exit(code));

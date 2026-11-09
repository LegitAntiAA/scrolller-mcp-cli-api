"""Live smoke test for the Scrolller transport (T7-phase1).

Usage: ``python -m scrolller.smoke``

Runs the verbatim discover query from RESEARCH.md §3 with limit 2 and prints
the page iterator, the first subreddit title and the first post's best media
URL. Exits non-zero on any failure.
"""

from __future__ import annotations

import sys
from typing import Any, Dict

from scrolller._download import best_media_source
from scrolller._errors import ScrolllerError
from scrolller.client import ScrolllerClient

DISCOVER_QUERY = """\
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
}"""


def main() -> int:
    variables: Dict[str, Any] = {
        "filter": None,
        "sortBy": "HOT",
        "limit": 2,
        "childLimit": 2,
        "iterator": None,
        "includeFilters": [],
        "excludeFilters": None,
        "nsfw": "SFW",
    }
    try:
        client = ScrolllerClient()
        data = client.request(DISCOVER_QUERY, variables)
    except ScrolllerError as exc:
        kind = exc.kind.value if exc.kind is not None else "UNKNOWN"
        print(f"smoke FAILED: [{kind}] {exc}", file=sys.stderr)
        return 1

    feed = (data or {}).get("discoverFilteredSubreddits") or {}
    print("iterator:", feed.get("iterator"))

    items = feed.get("items") or []
    if not items:
        print("smoke FAILED: feed returned no subreddit items", file=sys.stderr)
        return 1
    first = items[0]
    print("first subreddit title:", first.get("title"))

    posts = ((first.get("children") or {}).get("items")) or []
    if not posts:
        print("smoke FAILED: first subreddit card embeds no posts", file=sys.stderr)
        return 1
    try:
        source = best_media_source(posts[0])
    except ScrolllerError as exc:
        print(f"smoke FAILED: first post has no media ({exc})", file=sys.stderr)
        return 1
    print("first post media URL:", source.get("url"))
    return 0


if __name__ == "__main__":
    sys.exit(main())

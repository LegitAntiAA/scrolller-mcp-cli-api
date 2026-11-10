"""Live smoke test for the Scrolller operation layer (T7-phase2).

Usage: ``python -m scrolller.smoke``

Exercises the real PUBLIC operations against the live API, one printed line
per operation (CONTRACT.md §6; no authenticated calls):

1. discover (page 1)            — DiscoverFilteredSubredditsQuery
2. subreddit feed /r/aww        — SubredditQuery
3. search_subreddits("car")     — SearchSubredditsQuery
4. get_post of a discovered post — SubredditPostQuery
5. get_comments of that post    — getCommentsQuery (plain array)
6. agent_subreddit("carporn")   — official GET /agent/* route
7. auth fail-fast: like() without a token must raise
   ScrolllerAuthRequiredError BEFORE any network call (§5.1)

Exits non-zero on any failure.
"""

from __future__ import annotations

import sys
import time
from typing import Any, Callable, TypeVar

from scrolller._errors import AuthRequiredError, ScrolllerError
from scrolller.client import ScrolllerClient

T = TypeVar("T")


def _with_retry(action: Callable[[], T], attempts: int = 2, delay_s: float = 2.0) -> T:
    """Retry once on failure — the API can soft-null under rapid requests."""
    last: Any = None
    for attempt in range(1, attempts + 1):
        try:
            return action()
        except ScrolllerError as exc:
            last = exc
            if attempt < attempts:
                time.sleep(delay_s)
    raise last


def _safe(value: Any) -> str:
    """ASCII-safe rendering for Windows consoles (cp1251 cannot map emoji in
    live post titles — a print() crash must never fail the smoke run)."""
    return str(value).encode("ascii", "backslashreplace").decode("ascii")


def main() -> int:
    try:
        client = ScrolllerClient()
    except ScrolllerError as exc:
        print(f"smoke FAILED: client init [{exc.kind.value if exc.kind else 'UNKNOWN'}] {exc}", file=sys.stderr)
        return 1
    # The smoke run is strictly anonymous (no authenticated live calls): even
    # if the user's config carries a token, drop it for this client. Step 7
    # then deterministically proves the §5.1 fail-fast.
    client._options.token = None

    try:
        # 1. discover feed (page 1; SFW default)
        page = _with_retry(lambda: client.discover(limit=2, child_limit=2))
        first_sub = page.items[0] if page.items else None
        print(
            "discover p1: iterator={!r} subreddits={} first={!r}".format(
                page.iterator, len(page.items), _safe(first_sub.title) if first_sub else None
            )
        )
        if not first_sub:
            raise ScrolllerError("discover returned no subreddit items")

        # 2. subreddit feed (SubredditQuery)
        feed = _with_retry(lambda: client.subreddit_feed("/r/aww", limit=10))
        feed_posts = feed.children or []
        print(
            "subreddit /r/aww: id={} title={!r} children_iterator={!r} posts={}".format(
                feed.id, _safe(feed.title), feed.children_iterator, len(feed_posts)
            )
        )

        # 3. subreddit search (pageIndex family)
        results = client.search_subreddits("car", limit=5)
        print(
            "search_subreddits('car'): results={} first={!r}".format(
                len(results), results[0].url if results else None
            )
        )

        # 4. get_post of a discovered post (post url passed through verbatim;
        #    prefer the most-commented feed post, fall back to discover cards)
        candidates = sorted(
            (p for p in feed_posts if p.url), key=lambda p: p.comments_count or 0, reverse=True
        ) or [p for card in page.items for p in (card.children or []) if p.url]
        post_url = candidates[0].url if candidates else None
        if not post_url:
            raise ScrolllerError("no discovered post url for get_post")
        post = _with_retry(lambda: client.get_post(post_url))
        print(
            "get_post: id={} title={!r} sources={} comments={}".format(
                post.id, _safe(post.title), len(post.media_sources or []), post.comments_count
            )
        )
        if post.id is None:
            raise ScrolllerError(f"getPost returned no id for {post_url!r}")

        # 5. comments of that post (plain-array reader). A live quirk worth
        #    noting: the scrolller-NATIVE comment base is sparse — most posts
        #    report commentsCount 0 and the reader legitimately returns an
        #    empty plain array, which is the documented response shape.
        comments = client.get_comments(post.id, limit=15)
        print(
            "get_comments: count={} first_id={}".format(
                len(comments), comments[0].id if comments else None
            )
        )

        # 6. official agent route (embed-safe JSON, ~1 req/s rate limit)
        agent = client.agent_subreddit("carporn")
        print("agent_subreddit('carporn'): keys={}".format(sorted(agent.keys())[:6]))

        # 7. AUTH fail-fast (no token configured — must raise before network)
        try:
            client.like(post.url or post_url)
        except AuthRequiredError:
            print("auth fail-fast: like() without token raised ScrolllerAuthRequiredError OK")
        else:
            raise ScrolllerError("like() without token did NOT raise ScrolllerAuthRequiredError")
    except ScrolllerError as exc:
        kind = exc.kind.value if exc.kind is not None else "UNKNOWN"
        print(f"smoke FAILED: [{kind}] {exc}", file=sys.stderr)
        return 1
    finally:
        client.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Post-level operations (CONTRACT.md §6 rows 5, 19, 20, 28, 30 + T1 §3a/§3b).

``PostOps`` / ``AsyncPostOps`` mix into the client classes. Includes the
embed-safe official agent routes (plain GET JSON, rate-limited to ~1 req/s
per RESEARCH.md §4b) and link resolution.
"""

from __future__ import annotations

import urllib.parse
from typing import Any, AsyncIterator, Dict, Iterator, List, Optional, Sequence

from scrolller._graphql import (
    Q_GET_POST,
    Q_GET_POST_RECOMMENDATIONS,
    Q_GET_POSTS_BY_CREATORS,
    Q_POST_HIDDEN_TAGS,
    Q_POSTS_BY_TAG,
    Q_REDDIT_USER_POSTS,
    Q_RESOLVE_LINKS,
    Q_USER_POSTS,
    enum_value,
)
from scrolller._models import (
    Page,
    Post,
    ResolvedLink,
    TagLink,
    is_exhausted_cursor,
    page_from_raw,
    post_from_raw,
    resolved_link_from_raw,
    tag_link_from_raw,
)

__all__ = ["AsyncPostOps", "PostOps"]


def _iterator_feed_variables(
    *,
    limit: int,
    iterator: Optional[str],
    filter: Optional[str],  # noqa: A002 — GraphQL argument name
    sort_by: Optional[str],
    nsfw: Optional[str],
) -> Dict[str, Any]:
    return {
        "iterator": iterator,
        "filter": filter,
        "sortBy": sort_by,
        "limit": int(limit),
        "nsfw": nsfw,
    }


class PostOps:
    """Sync mixin: get_post, feeds by user/creator/tag, resolve, agent routes."""

    def get_post(self, url: str) -> Post:
        """One post by scrolller URL (SubredditPostQuery, withParent=true shape)."""
        data = self._request(Q_GET_POST, {"url": url})
        return post_from_raw((data or {}).get("getPost") or {})

    def get_user_posts(
        self,
        username: str,
        *,
        limit: int = 50,
        iterator: Optional[str] = None,
        sort_by: Any = None,
        filter: Any = None,  # noqa: A002
        nsfw: Any = None,
    ) -> Page:
        """Posts of a scrolller creator account (UserPostsQuery)."""
        variables = _iterator_feed_variables(
            limit=limit,
            iterator=iterator,
            filter=enum_value(filter),
            sort_by=enum_value(sort_by),
            nsfw=self._nsfw_value(nsfw),
        )
        variables["username"] = username
        data = self._request(Q_USER_POSTS, variables)
        return page_from_raw((data or {}).get("getUserPosts"), post_from_raw)

    def get_user_posts_pages(
        self,
        username: str,
        *,
        max_pages: Optional[int] = None,
        iterator: Optional[str] = None,
        **opts: Any,
    ) -> Iterator[Page]:
        pages = 0
        while max_pages is None or pages < max_pages:
            page = self.get_user_posts(username, iterator=iterator, **opts)
            pages += 1
            yield page
            iterator = page.iterator
            if is_exhausted_cursor(iterator):
                return

    def list_user_posts(
        self, username: str, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Post]:
        items: List[Post] = []
        for page in self.get_user_posts_pages(username, **opts):
            for post in page.items:
                items.append(post)
                if limit is not None and len(items) >= limit:
                    return items
        return items

    def get_reddit_user_posts(
        self,
        username: str,
        *,
        limit: int = 50,
        iterator: Optional[str] = None,
        sort_by: Any = None,
        filter: Any = None,  # noqa: A002
        nsfw: Any = None,
    ) -> Page:
        """Posts of a Reddit user mirrored on Scrolller (RedditUserPostsQuery)."""
        variables = _iterator_feed_variables(
            limit=limit,
            iterator=iterator,
            filter=enum_value(filter),
            sort_by=enum_value(sort_by),
            nsfw=self._nsfw_value(nsfw),
        )
        variables["username"] = username
        data = self._request(Q_REDDIT_USER_POSTS, variables)
        return page_from_raw((data or {}).get("getRedditUserPosts"), post_from_raw)

    def get_reddit_user_posts_pages(
        self,
        username: str,
        *,
        max_pages: Optional[int] = None,
        iterator: Optional[str] = None,
        **opts: Any,
    ) -> Iterator[Page]:
        pages = 0
        while max_pages is None or pages < max_pages:
            page = self.get_reddit_user_posts(username, iterator=iterator, **opts)
            pages += 1
            yield page
            iterator = page.iterator
            if is_exhausted_cursor(iterator):
                return

    def list_reddit_user_posts(
        self, username: str, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Post]:
        items: List[Post] = []
        for page in self.get_reddit_user_posts_pages(username, **opts):
            for post in page.items:
                items.append(post)
                if limit is not None and len(items) >= limit:
                    return items
        return items

    def get_posts_by_creators(
        self,
        *,
        limit: int = 50,
        iterator: Optional[str] = "",
        sort_by: Any = None,
        filter: Any = None,  # noqa: A002
        nsfw: Any = None,
    ) -> Page:
        """Posts from followed/all creators (GetPostsByCreators).

        The site starts this feed with the empty-string iterator — keep the
        default to match (T1 §6); pass the previous page's iterator back
        verbatim afterwards.
        """
        variables = _iterator_feed_variables(
            limit=limit,
            iterator=iterator,
            filter=enum_value(filter),
            sort_by=enum_value(sort_by),
            nsfw=self._nsfw_value(nsfw),
        )
        data = self._request(Q_GET_POSTS_BY_CREATORS, variables)
        return page_from_raw((data or {}).get("getPostsByCreators"), post_from_raw)

    def get_posts_by_creators_pages(
        self,
        *,
        max_pages: Optional[int] = None,
        iterator: Optional[str] = "",
        **opts: Any,
    ) -> Iterator[Page]:
        pages = 0
        while max_pages is None or pages < max_pages:
            page = self.get_posts_by_creators(iterator=iterator, **opts)
            pages += 1
            yield page
            iterator = page.iterator
            if is_exhausted_cursor(iterator):
                return

    def list_posts_by_creators(self, *, limit: Optional[int] = None, **opts: Any) -> List[Post]:
        items: List[Post] = []
        for page in self.get_posts_by_creators_pages(**opts):
            for post in page.items:
                items.append(post)
                if limit is not None and len(items) >= limit:
                    return items
        return items

    def posts_by_tag(
        self,
        tag: str,
        *,
        limit: int = 50,
        iterator: Optional[str] = None,
        sort_by: Any = None,
        filter: Any = None,  # noqa: A002
        nsfw: Any = None,
    ) -> Page:
        """Posts carrying a tag (PostsByTag → getPostsByTag).

        NOTE: the query document is verbatim, but ``PostsByTagInput``'s
        exact field list is only partially evidenced on the site (the caller
        spreads a feed-state object). The input here sends
        ``{tag, iterator, limit, nsfw, filter?, sortBy?}``; unused keys are
        omitted by the transport. Flagged as partially inferred in T1 §4.
        """
        variables = {
            "data": {
                "tag": tag,
                "iterator": iterator,
                "limit": int(limit),
                "filter": enum_value(filter),
                "sortBy": enum_value(sort_by),
                "nsfw": self._nsfw_value(nsfw),
            }
        }
        data = self._request(Q_POSTS_BY_TAG, variables)
        return page_from_raw((data or {}).get("getPostsByTag"), post_from_raw)

    def posts_by_tag_pages(
        self,
        tag: str,
        *,
        max_pages: Optional[int] = None,
        iterator: Optional[str] = None,
        **opts: Any,
    ) -> Iterator[Page]:
        pages = 0
        while max_pages is None or pages < max_pages:
            page = self.posts_by_tag(tag, iterator=iterator, **opts)
            pages += 1
            yield page
            iterator = page.iterator
            if is_exhausted_cursor(iterator):
                return

    def list_posts_by_tag(
        self, tag: str, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Post]:
        items: List[Post] = []
        for page in self.posts_by_tag_pages(tag, **opts):
            for post in page.items:
                items.append(post)
                if limit is not None and len(items) >= limit:
                    return items
        return items

    def resolve_links(self, urls: Sequence[str]) -> List[ResolvedLink]:
        """Resolve scrolller URLs to post/subreddit/collection (ResolveScrolllerLinks)."""
        data = self._request(Q_RESOLVE_LINKS, {"urls": list(urls)})
        return [
            resolved_link_from_raw(item)
            for item in ((data or {}).get("resolveScrolllerLinks") or [])
            if isinstance(item, dict)
        ]

    def resolve_link(self, url: str) -> Optional[ResolvedLink]:
        """Resolve one scrolller URL; ``None`` when the API returns no row."""
        results = self.resolve_links([url])
        return results[0] if results else None

    def related(self, ref: Any) -> List[str]:
        """Subreddit URLs recommended for a post ("More like this").

        SDL: GetAllRecommendationsContent (getPostRecommendations) — the only
        recommendations document in T1-RESEARCH-FULL.md; no per-slug
        "discover" query exists there (CONTRACT.md row 28 is provisional).
        ``ref`` is a numeric post id, numeric string, or scrolller post URL
        (relative paths are made absolute before resolving).
        """
        post_id = self._resolve_post_id(ref)
        data = self._request(Q_GET_POST_RECOMMENDATIONS, {"postId": post_id})
        payload = (data or {}).get("getPostRecommendations") or {}
        return [
            item.get("subredditUrl")
            for item in (payload.get("subreddits") or [])
            if isinstance(item, dict)
        ]

    def post_hidden_tags(self, post_id: int) -> List[TagLink]:
        """Hidden tags of a post (PostHiddenTags)."""
        data = self._request(Q_POST_HIDDEN_TAGS, {"postId": int(post_id)})
        return [
            tag_link_from_raw(item)
            for item in ((data or {}).get("getPostHiddenTags") or [])
            if isinstance(item, dict)
        ]

    # -- official agent routes (plain GET JSON, ~1 req/s) --------------------

    def agent_subreddit(self, slug: str, *, limit: Optional[int] = None) -> Dict[str, Any]:
        """``GET /agent/subreddit/{slug}`` — embed-safe JSON (no raw media)."""
        params = {"limit": int(limit)} if limit is not None else None
        return self._agent_get("/agent/subreddit/" + urllib.parse.quote(str(slug), safe=""), params=params)

    def agent_content(self, slug: str, *, limit: Optional[int] = None) -> Dict[str, Any]:
        """``GET /agent/content/{slug}`` — embed-safe JSON (no raw media).

        ``limit`` is accepted for call-site parity but not sent: the server
        honors ``?limit=`` only on the subreddit/collection routes
        (RESEARCH.md §4b).
        """
        return self._agent_get("/agent/content/" + urllib.parse.quote(str(slug), safe=""))

    def agent_collection(self, collection_id: int, *, limit: Optional[int] = None) -> Dict[str, Any]:
        """``GET /agent/collection/{id}`` — embed-safe JSON (no raw media)."""
        params = {"limit": int(limit)} if limit is not None else None
        return self._agent_get(
            "/agent/collection/" + urllib.parse.quote(str(int(collection_id)), safe=""), params=params
        )


class AsyncPostOps:
    """Async mirror of :class:`PostOps`."""

    async def get_post(self, url: str) -> Post:
        data = await self._request(Q_GET_POST, {"url": url})
        return post_from_raw((data or {}).get("getPost") or {})

    async def get_user_posts(
        self,
        username: str,
        *,
        limit: int = 50,
        iterator: Optional[str] = None,
        sort_by: Any = None,
        filter: Any = None,  # noqa: A002
        nsfw: Any = None,
    ) -> Page:
        variables = _iterator_feed_variables(
            limit=limit,
            iterator=iterator,
            filter=enum_value(filter),
            sort_by=enum_value(sort_by),
            nsfw=self._nsfw_value(nsfw),
        )
        variables["username"] = username
        data = await self._request(Q_USER_POSTS, variables)
        return page_from_raw((data or {}).get("getUserPosts"), post_from_raw)

    async def get_user_posts_pages(
        self,
        username: str,
        *,
        max_pages: Optional[int] = None,
        iterator: Optional[str] = None,
        **opts: Any,
    ) -> AsyncIterator[Page]:
        pages = 0
        while max_pages is None or pages < max_pages:
            page = await self.get_user_posts(username, iterator=iterator, **opts)
            pages += 1
            yield page
            iterator = page.iterator
            if is_exhausted_cursor(iterator):
                return

    async def list_user_posts(
        self, username: str, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Post]:
        items: List[Post] = []
        async for page in self.get_user_posts_pages(username, **opts):
            for post in page.items:
                items.append(post)
                if limit is not None and len(items) >= limit:
                    return items
        return items

    async def get_reddit_user_posts(
        self,
        username: str,
        *,
        limit: int = 50,
        iterator: Optional[str] = None,
        sort_by: Any = None,
        filter: Any = None,  # noqa: A002
        nsfw: Any = None,
    ) -> Page:
        variables = _iterator_feed_variables(
            limit=limit,
            iterator=iterator,
            filter=enum_value(filter),
            sort_by=enum_value(sort_by),
            nsfw=self._nsfw_value(nsfw),
        )
        variables["username"] = username
        data = await self._request(Q_REDDIT_USER_POSTS, variables)
        return page_from_raw((data or {}).get("getRedditUserPosts"), post_from_raw)

    async def get_reddit_user_posts_pages(
        self,
        username: str,
        *,
        max_pages: Optional[int] = None,
        iterator: Optional[str] = None,
        **opts: Any,
    ) -> AsyncIterator[Page]:
        pages = 0
        while max_pages is None or pages < max_pages:
            page = await self.get_reddit_user_posts(username, iterator=iterator, **opts)
            pages += 1
            yield page
            iterator = page.iterator
            if is_exhausted_cursor(iterator):
                return

    async def list_reddit_user_posts(
        self, username: str, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Post]:
        items: List[Post] = []
        async for page in self.get_reddit_user_posts_pages(username, **opts):
            for post in page.items:
                items.append(post)
                if limit is not None and len(items) >= limit:
                    return items
        return items

    async def get_posts_by_creators(
        self,
        *,
        limit: int = 50,
        iterator: Optional[str] = "",
        sort_by: Any = None,
        filter: Any = None,  # noqa: A002
        nsfw: Any = None,
    ) -> Page:
        variables = _iterator_feed_variables(
            limit=limit,
            iterator=iterator,
            filter=enum_value(filter),
            sort_by=enum_value(sort_by),
            nsfw=self._nsfw_value(nsfw),
        )
        data = await self._request(Q_GET_POSTS_BY_CREATORS, variables)
        return page_from_raw((data or {}).get("getPostsByCreators"), post_from_raw)

    async def get_posts_by_creators_pages(
        self,
        *,
        max_pages: Optional[int] = None,
        iterator: Optional[str] = "",
        **opts: Any,
    ) -> AsyncIterator[Page]:
        pages = 0
        while max_pages is None or pages < max_pages:
            page = await self.get_posts_by_creators(iterator=iterator, **opts)
            pages += 1
            yield page
            iterator = page.iterator
            if is_exhausted_cursor(iterator):
                return

    async def list_posts_by_creators(
        self, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Post]:
        items: List[Post] = []
        async for page in self.get_posts_by_creators_pages(**opts):
            for post in page.items:
                items.append(post)
                if limit is not None and len(items) >= limit:
                    return items
        return items

    async def posts_by_tag(
        self,
        tag: str,
        *,
        limit: int = 50,
        iterator: Optional[str] = None,
        sort_by: Any = None,
        filter: Any = None,  # noqa: A002
        nsfw: Any = None,
    ) -> Page:
        variables = {
            "data": {
                "tag": tag,
                "iterator": iterator,
                "limit": int(limit),
                "filter": enum_value(filter),
                "sortBy": enum_value(sort_by),
                "nsfw": self._nsfw_value(nsfw),
            }
        }
        data = await self._request(Q_POSTS_BY_TAG, variables)
        return page_from_raw((data or {}).get("getPostsByTag"), post_from_raw)

    async def posts_by_tag_pages(
        self,
        tag: str,
        *,
        max_pages: Optional[int] = None,
        iterator: Optional[str] = None,
        **opts: Any,
    ) -> AsyncIterator[Page]:
        pages = 0
        while max_pages is None or pages < max_pages:
            page = await self.posts_by_tag(tag, iterator=iterator, **opts)
            pages += 1
            yield page
            iterator = page.iterator
            if is_exhausted_cursor(iterator):
                return

    async def list_posts_by_tag(
        self, tag: str, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Post]:
        items: List[Post] = []
        async for page in self.posts_by_tag_pages(tag, **opts):
            for post in page.items:
                items.append(post)
                if limit is not None and len(items) >= limit:
                    return items
        return items

    async def resolve_links(self, urls: Sequence[str]) -> List[ResolvedLink]:
        data = await self._request(Q_RESOLVE_LINKS, {"urls": list(urls)})
        return [
            resolved_link_from_raw(item)
            for item in ((data or {}).get("resolveScrolllerLinks") or [])
            if isinstance(item, dict)
        ]

    async def resolve_link(self, url: str) -> Optional[ResolvedLink]:
        results = await self.resolve_links([url])
        return results[0] if results else None

    async def related(self, ref: Any) -> List[str]:
        post_id = await self._resolve_post_id(ref)
        data = await self._request(Q_GET_POST_RECOMMENDATIONS, {"postId": post_id})
        payload = (data or {}).get("getPostRecommendations") or {}
        return [
            item.get("subredditUrl")
            for item in (payload.get("subreddits") or [])
            if isinstance(item, dict)
        ]

    async def post_hidden_tags(self, post_id: int) -> List[TagLink]:
        data = await self._request(Q_POST_HIDDEN_TAGS, {"postId": int(post_id)})
        return [
            tag_link_from_raw(item)
            for item in ((data or {}).get("getPostHiddenTags") or [])
            if isinstance(item, dict)
        ]

    async def agent_subreddit(self, slug: str, *, limit: Optional[int] = None) -> Dict[str, Any]:
        params = {"limit": int(limit)} if limit is not None else None
        return await self._agent_get(
            "/agent/subreddit/" + urllib.parse.quote(str(slug), safe=""), params=params
        )

    async def agent_content(self, slug: str, *, limit: Optional[int] = None) -> Dict[str, Any]:
        # ``limit`` is not sent on the content route (RESEARCH.md §4b).
        return await self._agent_get("/agent/content/" + urllib.parse.quote(str(slug), safe=""))

    async def agent_collection(
        self, collection_id: int, *, limit: Optional[int] = None
    ) -> Dict[str, Any]:
        params = {"limit": int(limit)} if limit is not None else None
        return await self._agent_get(
            "/agent/collection/" + urllib.parse.quote(str(int(collection_id)), safe=""), params=params
        )

"""Public feed/search operations (CONTRACT.md §6 rows 1, 3, 4, 29 + T1 §3a/§3b).

``FeedOps`` mixes into :class:`ScrolllerClient` (sync); ``AsyncFeedOps`` into
:class:`AsyncScrolllerClient`. Both share the variable builders and parsers
at module level. Page generators pass ``iterator`` strings back BYTE-EXACT
(CONTRACT.md §1).
"""

from __future__ import annotations

from typing import Any, AsyncIterator, Dict, Iterator, List, Optional, Sequence

from scrolller._graphql import (
    Q_DISCOVER,
    Q_GET_CATEGORIES,
    Q_SEARCH_SUBREDDITS,
    Q_SEARCH_SUBREDDIT_WITH_PREVIEW,
    Q_SEARCH_USERS,
    Q_SUBREDDIT,
    Q_SUBREDDIT_CHILDREN,
    enum_value,
)
from scrolller._models import (
    Page,
    SearchUser,
    Subreddit,
    SubredditSearchResult,
    is_exhausted_cursor,
    page_from_raw,
    post_from_raw,
    search_user_from_raw,
    subreddit_from_raw,
    subreddit_search_result_from_raw,
)

__all__ = ["AsyncFeedOps", "FeedOps"]


def _discover_variables(
    *,
    nsfw: str,
    limit: int,
    child_limit: int,
    sort_by: Optional[str],
    filter: Optional[str],  # noqa: A002 — GraphQL argument name
    iterator: Optional[str],
    include_filters: Optional[Sequence[int]],
    exclude_filters: Optional[Sequence[int]],
) -> Dict[str, Any]:
    # None values are dropped by the transport — the null-variable trap
    # (CONTRACT.md §1): $filter/$includeFilters/$excludeFilters MUST be
    # omitted rather than sent as explicit nulls.
    return {
        "nsfw": nsfw,
        "filter": filter,
        "limit": int(limit),
        "childLimit": int(child_limit),
        "iterator": iterator,
        "includeFilters": list(include_filters) if include_filters is not None else None,
        "excludeFilters": list(exclude_filters) if exclude_filters is not None else None,
        "sortBy": sort_by,
    }


class FeedOps:
    """Sync mixin: discover / subreddit feeds / search family / categories."""

    def discover(
        self,
        *,
        limit: int = 10,
        child_limit: int = 2,
        sort_by: Any = None,
        filter: Any = None,  # noqa: A002
        iterator: Optional[str] = None,
        include_filters: Optional[Sequence[int]] = None,
        exclude_filters: Optional[Sequence[int]] = None,
        nsfw: Any = None,
    ) -> Page:
        """Home/discover feed (DiscoverFilteredSubredditsQuery).

        Returns one page: subreddit cards with ``items`` of
        :class:`scrolller.Subreddit` (each embedding up to ``child_limit``
        posts in ``children``). Site values: ``childLimit=2`` home feed,
        ``childLimit=1`` category views; ``limit=ceil(posts/2)``.
        ``iterator`` strings are opaque — pass the previous page's value
        back verbatim.
        """
        variables = _discover_variables(
            nsfw=self._nsfw_value(nsfw),
            limit=limit,
            child_limit=child_limit,
            sort_by=enum_value(sort_by),
            filter=enum_value(filter),
            iterator=iterator,
            include_filters=include_filters,
            exclude_filters=exclude_filters,
        )
        data = self._request(Q_DISCOVER, variables)
        return page_from_raw((data or {}).get("discoverFilteredSubreddits"), subreddit_from_raw)

    def discover_pages(
        self,
        *,
        max_pages: Optional[int] = None,
        iterator: Optional[str] = None,
        **opts: Any,
    ) -> Iterator[Page]:
        """Yield discover pages until the server stops returning an iterator."""
        pages = 0
        while max_pages is None or pages < max_pages:
            page = self.discover(iterator=iterator, **opts)
            pages += 1
            yield page
            iterator = page.iterator
            if is_exhausted_cursor(iterator):
                return

    def list_discover(self, *, limit: Optional[int] = None, **opts: Any) -> List[Subreddit]:
        """Collect subreddit cards across pages (up to ``limit``)."""
        items: List[Subreddit] = []
        for page in self.discover_pages(**opts):
            for item in page.items:
                items.append(item)
                if limit is not None and len(items) >= limit:
                    return items
        return items

    def subreddit_feed(
        self,
        url: str,
        *,
        limit: int = 50,
        sort_by: Any = None,
        filter: Any = None,  # noqa: A002
        iterator: Optional[str] = None,
        with_display_media: bool = False,
    ) -> Subreddit:
        """Subreddit feed (SubredditQuery → getSubreddit).

        ``url`` is passed through verbatim (e.g. ``/r/aww``). The embedded
        ``children`` carry the next page's ``children_iterator`` — continue
        via :meth:`subreddit_pages` / :meth:`subreddit_children`. Note the
        SDL has no ``nsfw`` variable here; content is governed by the
        subreddit itself.
        """
        variables = {
            "url": url,
            "iterator": iterator,
            "sortBy": enum_value(sort_by),
            "filter": enum_value(filter),
            "limit": int(limit),
        }
        data = self._request(Q_SUBREDDIT, variables)
        return subreddit_from_raw((data or {}).get("getSubreddit") or {})

    def subreddit_pages(
        self,
        url: str,
        *,
        max_pages: Optional[int] = None,
        iterator: Optional[str] = None,
        **opts: Any,
    ) -> Iterator[Subreddit]:
        """Yield :class:`Subreddit` objects whose ``children`` hold each page's
        posts; the response's ``children.iterator`` drives pagination.

        ``iterator`` here is the feed iterator (start: ``None``).
        """
        pages = 0
        while max_pages is None or pages < max_pages:
            feed = self.subreddit_feed(url, iterator=iterator, **opts)
            pages += 1
            yield feed
            iterator = feed.children_iterator
            if is_exhausted_cursor(iterator):
                return

    def list_subreddit_posts(
        self, url: str, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Any]:
        """Collect posts of a subreddit across pages (up to ``limit``)."""
        items: List[Any] = []
        for feed in self.subreddit_pages(url, **opts):
            for post in feed.children or []:
                items.append(post)
                if limit is not None and len(items) >= limit:
                    return items
        return items

    def subreddit_children(
        self,
        subreddit_id: int,
        *,
        limit: int = 50,
        sort_by: Any = None,
        filter: Any = None,  # noqa: A002
        iterator: Optional[str] = None,
        nsfw: Any = None,
    ) -> Page:
        """Next batches of a subreddit's posts (SubredditChildrenQuery).

        Use the ``children_iterator`` from :meth:`subreddit_feed` (or the
        previous page's ``iterator``) to continue.
        """
        variables = {
            "subredditId": int(subreddit_id),
            "iterator": iterator,
            "filter": enum_value(filter),
            "sortBy": enum_value(sort_by),
            "limit": int(limit),
            "nsfw": self._nsfw_value(nsfw),
        }
        data = self._request(Q_SUBREDDIT_CHILDREN, variables)
        return page_from_raw((data or {}).get("getSubredditChildren"), post_from_raw)

    def subreddit_children_pages(
        self,
        subreddit_id: int,
        *,
        max_pages: Optional[int] = None,
        iterator: Optional[str] = None,
        **opts: Any,
    ) -> Iterator[Page]:
        pages = 0
        while max_pages is None or pages < max_pages:
            page = self.subreddit_children(subreddit_id, iterator=iterator, **opts)
            pages += 1
            yield page
            iterator = page.iterator
            if is_exhausted_cursor(iterator):
                return

    def list_subreddit_children(
        self, subreddit_id: int, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Any]:
        items: List[Any] = []
        for page in self.subreddit_children_pages(subreddit_id, **opts):
            for item in page.items:
                items.append(item)
                if limit is not None and len(items) >= limit:
                    return items
        return items

    def get_categories(self, *, is_nsfw: bool = False, sort: Optional[str] = None) -> List[Dict[str, Any]]:
        """Category tree (getCategories; 4 levels, raw nested dicts).

        Useful to find category ids for ``include_filters``/``exclude_filters``
        on :meth:`discover` (CONTRACT.md §6 row 29).
        """
        variables = {"sort": sort, "nsfw": bool(is_nsfw)}
        data = self._request(Q_GET_CATEGORIES, variables)
        result = (data or {}).get("categories")
        return result if isinstance(result, list) else []

    # -- search family (pageIndex/offset pagination, T1 §6) -----------------

    def search_subreddits(
        self,
        query: str,
        *,
        limit: int = 50,
        is_nsfw: Optional[bool] = None,
        page_index: int = 0,
    ) -> List[SubredditSearchResult]:
        """Subreddit search (SearchSubredditsQuery).

        ``is_nsfw`` defaults to ``client.nsfw != SFW``. Pages are offset by
        ``page_index``; a page shorter than ``limit`` is the last one.
        """
        if is_nsfw is None:
            is_nsfw = self._options.nsfw.value != "SFW"
        variables = {
            "query": query,
            "isNsfw": bool(is_nsfw),
            "limit": int(limit),
            "pageIndex": int(page_index),
        }
        data = self._request(Q_SEARCH_SUBREDDITS, variables)
        return [
            subreddit_search_result_from_raw(item)
            for item in ((data or {}).get("searchSubreddits") or [])
            if isinstance(item, dict)
        ]

    def search_subreddits_pages(
        self,
        query: str,
        *,
        limit: int = 50,
        max_pages: Optional[int] = None,
        page_index: int = 0,
        **opts: Any,
    ) -> Iterator[List[SubredditSearchResult]]:
        index = int(page_index)
        pages = 0
        while max_pages is None or pages < max_pages:
            items = self.search_subreddits(query, limit=limit, page_index=index, **opts)
            pages += 1
            yield items
            if len(items) < int(limit):
                return
            index += 1

    def list_search_subreddits(
        self, query: str, *, limit: Optional[int] = None, **opts: Any
    ) -> List[SubredditSearchResult]:
        items: List[SubredditSearchResult] = []
        for page in self.search_subreddits_pages(query, **opts):
            for item in page:
                items.append(item)
                if limit is not None and len(items) >= limit:
                    return items
        return items

    def search_subreddit_with_preview(
        self, query: str, *, limit: int = 50, page_index: int = 0
    ) -> List[SubredditSearchResult]:
        """Autocomplete-style search with a single preview image."""
        variables = {"query": query, "limit": int(limit), "pageIndex": int(page_index)}
        data = self._request(Q_SEARCH_SUBREDDIT_WITH_PREVIEW, variables)
        return [
            subreddit_search_result_from_raw(item)
            for item in ((data or {}).get("searchSubredditWithPreview") or [])
            if isinstance(item, dict)
        ]

    def search_subreddit_with_preview_pages(
        self,
        query: str,
        *,
        limit: int = 50,
        max_pages: Optional[int] = None,
        page_index: int = 0,
    ) -> Iterator[List[SubredditSearchResult]]:
        index = int(page_index)
        pages = 0
        while max_pages is None or pages < max_pages:
            items = self.search_subreddit_with_preview(query, limit=limit, page_index=index)
            pages += 1
            yield items
            if len(items) < int(limit):
                return
            index += 1

    def list_search_subreddit_with_preview(
        self, query: str, *, limit: Optional[int] = None, **opts: Any
    ) -> List[SubredditSearchResult]:
        items: List[SubredditSearchResult] = []
        for page in self.search_subreddit_with_preview_pages(query, **opts):
            for item in page:
                items.append(item)
                if limit is not None and len(items) >= limit:
                    return items
        return items

    def search_users(
        self, query: str, *, limit: int = 50, page_index: int = 0
    ) -> List[SearchUser]:
        variables = {"query": query, "limit": int(limit), "pageIndex": int(page_index)}
        data = self._request(Q_SEARCH_USERS, variables)
        return [
            search_user_from_raw(item)
            for item in ((data or {}).get("searchUsers") or [])
            if isinstance(item, dict)
        ]

    def search_users_pages(
        self,
        query: str,
        *,
        limit: int = 50,
        max_pages: Optional[int] = None,
        page_index: int = 0,
    ) -> Iterator[List[SearchUser]]:
        index = int(page_index)
        pages = 0
        while max_pages is None or pages < max_pages:
            items = self.search_users(query, limit=limit, page_index=index)
            pages += 1
            yield items
            if len(items) < int(limit):
                return
            index += 1

    def list_search_users(
        self, query: str, *, limit: Optional[int] = None, **opts: Any
    ) -> List[SearchUser]:
        items: List[SearchUser] = []
        for page in self.search_users_pages(query, **opts):
            for item in page:
                items.append(item)
                if limit is not None and len(items) >= limit:
                    return items
        return items


class AsyncFeedOps:
    """Async mirror of :class:`FeedOps` (same surface, awaited + async generators)."""

    async def discover(
        self,
        *,
        limit: int = 10,
        child_limit: int = 2,
        sort_by: Any = None,
        filter: Any = None,  # noqa: A002
        iterator: Optional[str] = None,
        include_filters: Optional[Sequence[int]] = None,
        exclude_filters: Optional[Sequence[int]] = None,
        nsfw: Any = None,
    ) -> Page:
        variables = _discover_variables(
            nsfw=self._nsfw_value(nsfw),
            limit=limit,
            child_limit=child_limit,
            sort_by=enum_value(sort_by),
            filter=enum_value(filter),
            iterator=iterator,
            include_filters=include_filters,
            exclude_filters=exclude_filters,
        )
        data = await self._request(Q_DISCOVER, variables)
        return page_from_raw((data or {}).get("discoverFilteredSubreddits"), subreddit_from_raw)

    async def discover_pages(
        self,
        *,
        max_pages: Optional[int] = None,
        iterator: Optional[str] = None,
        **opts: Any,
    ) -> AsyncIterator[Page]:
        pages = 0
        while max_pages is None or pages < max_pages:
            page = await self.discover(iterator=iterator, **opts)
            pages += 1
            yield page
            iterator = page.iterator
            if is_exhausted_cursor(iterator):
                return

    async def list_discover(self, *, limit: Optional[int] = None, **opts: Any) -> List[Subreddit]:
        items: List[Subreddit] = []
        async for page in self.discover_pages(**opts):
            for item in page.items:
                items.append(item)
                if limit is not None and len(items) >= limit:
                    return items
        return items

    async def subreddit_feed(
        self,
        url: str,
        *,
        limit: int = 50,
        sort_by: Any = None,
        filter: Any = None,  # noqa: A002
        iterator: Optional[str] = None,
        with_display_media: bool = False,
    ) -> Subreddit:
        variables = {
            "url": url,
            "iterator": iterator,
            "sortBy": enum_value(sort_by),
            "filter": enum_value(filter),
            "limit": int(limit),
        }
        data = await self._request(Q_SUBREDDIT, variables)
        return subreddit_from_raw((data or {}).get("getSubreddit") or {})

    async def subreddit_pages(
        self,
        url: str,
        *,
        max_pages: Optional[int] = None,
        iterator: Optional[str] = None,
        **opts: Any,
    ) -> AsyncIterator[Subreddit]:
        pages = 0
        while max_pages is None or pages < max_pages:
            feed = await self.subreddit_feed(url, iterator=iterator, **opts)
            pages += 1
            yield feed
            iterator = feed.children_iterator
            if is_exhausted_cursor(iterator):
                return

    async def list_subreddit_posts(
        self, url: str, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Any]:
        items: List[Any] = []
        async for feed in self.subreddit_pages(url, **opts):
            for post in feed.children or []:
                items.append(post)
                if limit is not None and len(items) >= limit:
                    return items
        return items

    async def subreddit_children(
        self,
        subreddit_id: int,
        *,
        limit: int = 50,
        sort_by: Any = None,
        filter: Any = None,  # noqa: A002
        iterator: Optional[str] = None,
        nsfw: Any = None,
    ) -> Page:
        variables = {
            "subredditId": int(subreddit_id),
            "iterator": iterator,
            "filter": enum_value(filter),
            "sortBy": enum_value(sort_by),
            "limit": int(limit),
            "nsfw": self._nsfw_value(nsfw),
        }
        data = await self._request(Q_SUBREDDIT_CHILDREN, variables)
        return page_from_raw((data or {}).get("getSubredditChildren"), post_from_raw)

    async def subreddit_children_pages(
        self,
        subreddit_id: int,
        *,
        max_pages: Optional[int] = None,
        iterator: Optional[str] = None,
        **opts: Any,
    ) -> AsyncIterator[Page]:
        pages = 0
        while max_pages is None or pages < max_pages:
            page = await self.subreddit_children(subreddit_id, iterator=iterator, **opts)
            pages += 1
            yield page
            iterator = page.iterator
            if is_exhausted_cursor(iterator):
                return

    async def list_subreddit_children(
        self, subreddit_id: int, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Any]:
        items: List[Any] = []
        async for page in self.subreddit_children_pages(subreddit_id, **opts):
            for item in page.items:
                items.append(item)
                if limit is not None and len(items) >= limit:
                    return items
        return items

    async def get_categories(
        self, *, is_nsfw: bool = False, sort: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        variables = {"sort": sort, "nsfw": bool(is_nsfw)}
        data = await self._request(Q_GET_CATEGORIES, variables)
        result = (data or {}).get("categories")
        return result if isinstance(result, list) else []

    async def search_subreddits(
        self,
        query: str,
        *,
        limit: int = 50,
        is_nsfw: Optional[bool] = None,
        page_index: int = 0,
    ) -> List[SubredditSearchResult]:
        if is_nsfw is None:
            is_nsfw = self._options.nsfw.value != "SFW"
        variables = {
            "query": query,
            "isNsfw": bool(is_nsfw),
            "limit": int(limit),
            "pageIndex": int(page_index),
        }
        data = await self._request(Q_SEARCH_SUBREDDITS, variables)
        return [
            subreddit_search_result_from_raw(item)
            for item in ((data or {}).get("searchSubreddits") or [])
            if isinstance(item, dict)
        ]

    async def search_subreddits_pages(
        self,
        query: str,
        *,
        limit: int = 50,
        max_pages: Optional[int] = None,
        page_index: int = 0,
        **opts: Any,
    ) -> AsyncIterator[List[SubredditSearchResult]]:
        index = int(page_index)
        pages = 0
        while max_pages is None or pages < max_pages:
            items = await self.search_subreddits(query, limit=limit, page_index=index, **opts)
            pages += 1
            yield items
            if len(items) < int(limit):
                return
            index += 1

    async def list_search_subreddits(
        self, query: str, *, limit: Optional[int] = None, **opts: Any
    ) -> List[SubredditSearchResult]:
        items: List[SubredditSearchResult] = []
        async for page in self.search_subreddits_pages(query, **opts):
            for item in page:
                items.append(item)
                if limit is not None and len(items) >= limit:
                    return items
        return items

    async def search_subreddit_with_preview(
        self, query: str, *, limit: int = 50, page_index: int = 0
    ) -> List[SubredditSearchResult]:
        variables = {"query": query, "limit": int(limit), "pageIndex": int(page_index)}
        data = await self._request(Q_SEARCH_SUBREDDIT_WITH_PREVIEW, variables)
        return [
            subreddit_search_result_from_raw(item)
            for item in ((data or {}).get("searchSubredditWithPreview") or [])
            if isinstance(item, dict)
        ]

    async def search_subreddit_with_preview_pages(
        self,
        query: str,
        *,
        limit: int = 50,
        max_pages: Optional[int] = None,
        page_index: int = 0,
    ) -> AsyncIterator[List[SubredditSearchResult]]:
        index = int(page_index)
        pages = 0
        while max_pages is None or pages < max_pages:
            items = await self.search_subreddit_with_preview(query, limit=limit, page_index=index)
            pages += 1
            yield items
            if len(items) < int(limit):
                return
            index += 1

    async def list_search_subreddit_with_preview(
        self, query: str, *, limit: Optional[int] = None, **opts: Any
    ) -> List[SubredditSearchResult]:
        items: List[SubredditSearchResult] = []
        async for page in self.search_subreddit_with_preview_pages(query, **opts):
            for item in page:
                items.append(item)
                if limit is not None and len(items) >= limit:
                    return items
        return items

    async def search_users(
        self, query: str, *, limit: int = 50, page_index: int = 0
    ) -> List[SearchUser]:
        variables = {"query": query, "limit": int(limit), "pageIndex": int(page_index)}
        data = await self._request(Q_SEARCH_USERS, variables)
        return [
            search_user_from_raw(item)
            for item in ((data or {}).get("searchUsers") or [])
            if isinstance(item, dict)
        ]

    async def search_users_pages(
        self,
        query: str,
        *,
        limit: int = 50,
        max_pages: Optional[int] = None,
        page_index: int = 0,
    ) -> AsyncIterator[List[SearchUser]]:
        index = int(page_index)
        pages = 0
        while max_pages is None or pages < max_pages:
            items = await self.search_users(query, limit=limit, page_index=index)
            pages += 1
            yield items
            if len(items) < int(limit):
                return
            index += 1

    async def list_search_users(
        self, query: str, *, limit: Optional[int] = None, **opts: Any
    ) -> List[SearchUser]:
        items: List[SearchUser] = []
        async for page in self.search_users_pages(query, **opts):
            for item in page:
                items.append(item)
                if limit is not None and len(items) >= limit:
                    return items
        return items

"""Social/moderation operations (CONTRACT.md §6 rows 8–10, 21, 27 + T1 §3d/§3h/§3i/§3j).

All operations here are fail-fast ``AUTH_REQUIRED`` without a token
(CONTRACT.md §5.1), except ``add_collection_impression`` which lives in the
collections module.
"""

from __future__ import annotations

from typing import Any, AsyncIterator, Dict, Iterator, List, Optional, Sequence

from scrolller._errors import ScrolllerError
from scrolller._graphql import (
    Q_ADD_FAVORITE,
    Q_FOLLOW,
    Q_GET_ALL_FOLLOWING_CONTENT,
    Q_GET_FOLLOWING_COLLECTIONS,
    Q_GET_FOLLOWING_SUBREDDITS,
    Q_GET_HIDE_RULES,
    Q_GET_HIDE_RULES_WITH_URL,
    Q_GET_IS_FOLLOWING_SUBREDDIT,
    Q_GET_IS_FOLLOWING_USER,
    Q_GET_IS_FOLLOWING_USER_COLLECTION,
    Q_GET_POST_IS_FAVORITE,
    Q_HIDE_CONTENT,
    Q_MARK_POST_WITH_SOUND,
    Q_REMOVE_FAVORITE,
    Q_REMOVE_REPOST,
    Q_REPOST_POST,
    Q_REPORT_COLLECTION,
    Q_REPORT_POST,
    Q_REPORT_USER,
    Q_UNFOLLOW,
    Q_UNHIDE_CONTENT,
    enum_value,
)
from scrolller._models import (
    Collection,
    FollowingContent,
    FollowingFlag,
    HideRule,
    Page,
    Subreddit,
    following_content_from_raw,
    hide_rule_from_raw,
    is_exhausted_cursor,
    page_from_raw,
    subreddit_from_raw,
)

__all__ = ["AsyncSocialOps", "SocialOps"]


def _validate_content_type(content_type: Any) -> str:
    value = str(content_type).upper()
    if value not in ("POST", "SUBREDDIT"):
        raise ScrolllerError("content_type must be 'POST' or 'SUBREDDIT'")
    return value


def _follow_feed_variables(
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


class SocialOps:
    """Sync mixin: favorites, reposts, follow, hide rules, reports."""

    # -- favorites / reposts (url arg, T1 §3h) -------------------------------

    def like(self, url: str) -> Any:
        """Favorite a post (AddFavorite). ``url`` is the scrolller post URL."""
        self._require_token()
        return self._request(Q_ADD_FAVORITE, {"url": url}, is_mutation=True)

    def unlike(self, url: str) -> Any:
        self._require_token()
        return self._request(Q_REMOVE_FAVORITE, {"url": url}, is_mutation=True)

    def is_favorite(self, url: str) -> bool:
        self._require_token()
        return bool(self._request(Q_GET_POST_IS_FAVORITE, {"url": url}))

    def repost(self, url: str) -> Any:
        self._require_token()
        return self._request(Q_REPOST_POST, {"url": url}, is_mutation=True)

    def unrepost(self, url: str) -> Any:
        self._require_token()
        return self._request(Q_REMOVE_REPOST, {"url": url}, is_mutation=True)

    def mark_post_with_sound(self, post_id: int, has_audio: bool = True) -> Any:
        """Report detected audio on a post (MarkPostWithSound → addWithSound)."""
        self._require_token()
        return self._request(
            Q_MARK_POST_WITH_SOUND,
            {"postId": int(post_id), "hasAudio": bool(has_audio)},
            is_mutation=True,
        )

    # -- follow (works for /r/... and user URLs, T1 §3d) ----------------------

    def follow(self, url: str) -> Any:
        self._require_token()
        return self._request(Q_FOLLOW, {"url": url}, is_mutation=True)

    def unfollow(self, url: str) -> Any:
        self._require_token()
        return self._request(Q_UNFOLLOW, {"url": url}, is_mutation=True)

    def is_following_subreddit(self, ids: Sequence[int]) -> List[FollowingFlag]:
        self._require_token()
        data = self._request(Q_GET_IS_FOLLOWING_SUBREDDIT, {"ids": [int(i) for i in ids]})
        return [
            FollowingFlag(id=item.get("id"), is_following=item.get("isFollowing"))
            for item in ((data or {}).get("getIsFollowingSubreddit") or [])
            if isinstance(item, dict)
        ]

    def is_following_user(
        self, *, id: Optional[int] = None, username: Optional[str] = None  # noqa: A002
    ) -> bool:
        """Follow state of one user by id and/or username (GetIsFollowingUser)."""
        self._require_token()
        if id is None and username is None:
            raise ScrolllerError("is_following_user() requires id and/or username")
        data = self._request(Q_GET_IS_FOLLOWING_USER, {"id": id, "username": username})
        payload = (data or {}).get("getIsFollowingUser") or {}
        return bool(payload.get("isFollowing")) if isinstance(payload, dict) else bool(payload)

    def is_following_collection(self, collection_id: int) -> bool:
        self._require_token()
        data = self._request(
            Q_GET_IS_FOLLOWING_USER_COLLECTION, {"id": int(collection_id)}
        )
        return bool(data)

    def get_following_subreddits(
        self,
        *,
        limit: int = 10,
        iterator: Optional[str] = None,
        sort_by: Any = None,
        filter: Any = None,  # noqa: A002
        nsfw: Any = None,
    ) -> Page:
        """Followed subreddits feed (GetFollowingSubreddits; site default limit 10)."""
        self._require_token()
        variables = _follow_feed_variables(
            limit=limit,
            iterator=iterator,
            filter=enum_value(filter),
            sort_by=enum_value(sort_by),
            nsfw=self._nsfw_value(nsfw),
        )
        data = self._request(Q_GET_FOLLOWING_SUBREDDITS, variables)
        return page_from_raw((data or {}).get("getFollowingSubreddits"), subreddit_from_raw)

    def get_following_subreddits_pages(
        self,
        *,
        max_pages: Optional[int] = None,
        iterator: Optional[str] = None,
        **opts: Any,
    ) -> Iterator[Page]:
        pages = 0
        while max_pages is None or pages < max_pages:
            page = self.get_following_subreddits(iterator=iterator, **opts)
            pages += 1
            yield page
            iterator = page.iterator
            if is_exhausted_cursor(iterator):
                return

    def list_following_subreddits(
        self, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Subreddit]:
        items: List[Subreddit] = []
        for page in self.get_following_subreddits_pages(**opts):
            for item in page.items:
                items.append(item)
                if limit is not None and len(items) >= limit:
                    return items
        return items

    def get_following_collections(
        self,
        *,
        limit: int = 10,
        iterator: Optional[str] = None,
        sort_by: Any = None,
        filter: Any = None,  # noqa: A002
        nsfw: Any = None,
    ) -> Page:
        """Followed collections feed (GetFollowingCollections; J-fragment items)."""
        self._require_token()
        variables = _follow_feed_variables(
            limit=limit,
            iterator=iterator,
            filter=enum_value(filter),
            sort_by=enum_value(sort_by),
            nsfw=self._nsfw_value(nsfw),
        )
        data = self._request(Q_GET_FOLLOWING_COLLECTIONS, variables)
        return page_from_raw((data or {}).get("getFollowingCollections"), subreddit_from_raw)

    def get_following_collections_pages(
        self,
        *,
        max_pages: Optional[int] = None,
        iterator: Optional[str] = None,
        **opts: Any,
    ) -> Iterator[Page]:
        pages = 0
        while max_pages is None or pages < max_pages:
            page = self.get_following_collections(iterator=iterator, **opts)
            pages += 1
            yield page
            iterator = page.iterator
            if is_exhausted_cursor(iterator):
                return

    def list_following_collections(
        self, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Collection]:
        items: List[Collection] = []
        for page in self.get_following_collections_pages(**opts):
            for item in page.items:
                items.append(item)
                if limit is not None and len(items) >= limit:
                    return items
        return items

    def get_all_following_content(self) -> FollowingContent:
        """Flat list of followed subreddit/collection URLs (GetAllFollowingContent)."""
        self._require_token()
        data = self._request(Q_GET_ALL_FOLLOWING_CONTENT)
        return following_content_from_raw((data or {}).get("getAllFollowingContent") or {})

    # -- hide rules (T1 §3i; contentType POST | SUBREDDIT) --------------------

    def hide_content(self, content_type: Any, target_id: int) -> HideRule:
        """Hide a post or subreddit (HideContent). Note UnhideContentInput's
        field shape is inferred from HideContentInput (T1 §4)."""
        self._require_token()
        data = self._request(
            Q_HIDE_CONTENT,
            {"data": {"contentType": _validate_content_type(content_type),
                      "targetId": int(target_id)}},
            is_mutation=True,
        )
        rule = ((data or {}).get("hideContent") or {}).get("rule") or {}
        return hide_rule_from_raw(rule)

    def unhide_content(self, content_type: Any, target_id: int) -> Any:
        self._require_token()
        return self._request(
            Q_UNHIDE_CONTENT,
            {"data": {"contentType": _validate_content_type(content_type),
                      "targetId": int(target_id)}},
            is_mutation=True,
        )

    def get_hide_rules(self) -> List[HideRule]:
        self._require_token()
        data = self._request(Q_GET_HIDE_RULES)
        return [
            hide_rule_from_raw(item)
            for item in ((data or {}).get("getUserHideContentRules") or [])
            if isinstance(item, dict)
        ]

    def get_hide_rules_with_url(self) -> List[HideRule]:
        self._require_token()
        data = self._request(Q_GET_HIDE_RULES_WITH_URL)
        return [
            hide_rule_from_raw(item)
            for item in ((data or {}).get("getUserHideContentRulesWithUrl") or [])
            if isinstance(item, dict)
        ]

    # -- reports (T1 §3j) ------------------------------------------------------

    def report_post(self, post_id: int, reason: str, details: Optional[str] = None) -> Any:
        self._require_token()
        return self._request(
            Q_REPORT_POST,
            {"postId": int(post_id), "reason": reason, "details": details},
            is_mutation=True,
        )

    def report_user(self, user_id: int, reason: str, details: Optional[str] = None) -> Any:
        self._require_token()
        return self._request(
            Q_REPORT_USER,
            {"userId": int(user_id), "reason": reason, "details": details},
            is_mutation=True,
        )

    def report_collection(
        self, collection_id: int, reason: str, details: Optional[str] = None
    ) -> Any:
        self._require_token()
        return self._request(
            Q_REPORT_COLLECTION,
            {"collectionId": int(collection_id), "reason": reason, "details": details},
            is_mutation=True,
        )


class AsyncSocialOps:
    """Async mirror of :class:`SocialOps`."""

    async def like(self, url: str) -> Any:
        self._require_token()
        return await self._request(Q_ADD_FAVORITE, {"url": url}, is_mutation=True)

    async def unlike(self, url: str) -> Any:
        self._require_token()
        return await self._request(Q_REMOVE_FAVORITE, {"url": url}, is_mutation=True)

    async def is_favorite(self, url: str) -> bool:
        self._require_token()
        return bool(await self._request(Q_GET_POST_IS_FAVORITE, {"url": url}))

    async def repost(self, url: str) -> Any:
        self._require_token()
        return await self._request(Q_REPOST_POST, {"url": url}, is_mutation=True)

    async def unrepost(self, url: str) -> Any:
        self._require_token()
        return await self._request(Q_REMOVE_REPOST, {"url": url}, is_mutation=True)

    async def mark_post_with_sound(self, post_id: int, has_audio: bool = True) -> Any:
        self._require_token()
        return await self._request(
            Q_MARK_POST_WITH_SOUND,
            {"postId": int(post_id), "hasAudio": bool(has_audio)},
            is_mutation=True,
        )

    async def follow(self, url: str) -> Any:
        self._require_token()
        return await self._request(Q_FOLLOW, {"url": url}, is_mutation=True)

    async def unfollow(self, url: str) -> Any:
        self._require_token()
        return await self._request(Q_UNFOLLOW, {"url": url}, is_mutation=True)

    async def is_following_subreddit(self, ids: Sequence[int]) -> List[FollowingFlag]:
        self._require_token()
        data = await self._request(
            Q_GET_IS_FOLLOWING_SUBREDDIT, {"ids": [int(i) for i in ids]}
        )
        return [
            FollowingFlag(id=item.get("id"), is_following=item.get("isFollowing"))
            for item in ((data or {}).get("getIsFollowingSubreddit") or [])
            if isinstance(item, dict)
        ]

    async def is_following_user(
        self, *, id: Optional[int] = None, username: Optional[str] = None  # noqa: A002
    ) -> bool:
        self._require_token()
        if id is None and username is None:
            raise ScrolllerError("is_following_user() requires id and/or username")
        data = await self._request(Q_GET_IS_FOLLOWING_USER, {"id": id, "username": username})
        payload = (data or {}).get("getIsFollowingUser") or {}
        return bool(payload.get("isFollowing")) if isinstance(payload, dict) else bool(payload)

    async def is_following_collection(self, collection_id: int) -> bool:
        self._require_token()
        data = await self._request(
            Q_GET_IS_FOLLOWING_USER_COLLECTION, {"id": int(collection_id)}
        )
        return bool(data)

    async def get_following_subreddits(
        self,
        *,
        limit: int = 10,
        iterator: Optional[str] = None,
        sort_by: Any = None,
        filter: Any = None,  # noqa: A002
        nsfw: Any = None,
    ) -> Page:
        self._require_token()
        variables = _follow_feed_variables(
            limit=limit,
            iterator=iterator,
            filter=enum_value(filter),
            sort_by=enum_value(sort_by),
            nsfw=self._nsfw_value(nsfw),
        )
        data = await self._request(Q_GET_FOLLOWING_SUBREDDITS, variables)
        return page_from_raw((data or {}).get("getFollowingSubreddits"), subreddit_from_raw)

    async def get_following_subreddits_pages(
        self,
        *,
        max_pages: Optional[int] = None,
        iterator: Optional[str] = None,
        **opts: Any,
    ) -> AsyncIterator[Page]:
        pages = 0
        while max_pages is None or pages < max_pages:
            page = await self.get_following_subreddits(iterator=iterator, **opts)
            pages += 1
            yield page
            iterator = page.iterator
            if is_exhausted_cursor(iterator):
                return

    async def list_following_subreddits(
        self, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Subreddit]:
        items: List[Subreddit] = []
        async for page in self.get_following_subreddits_pages(**opts):
            for item in page.items:
                items.append(item)
                if limit is not None and len(items) >= limit:
                    return items
        return items

    async def get_following_collections(
        self,
        *,
        limit: int = 10,
        iterator: Optional[str] = None,
        sort_by: Any = None,
        filter: Any = None,  # noqa: A002
        nsfw: Any = None,
    ) -> Page:
        self._require_token()
        variables = _follow_feed_variables(
            limit=limit,
            iterator=iterator,
            filter=enum_value(filter),
            sort_by=enum_value(sort_by),
            nsfw=self._nsfw_value(nsfw),
        )
        data = await self._request(Q_GET_FOLLOWING_COLLECTIONS, variables)
        return page_from_raw((data or {}).get("getFollowingCollections"), subreddit_from_raw)

    async def get_following_collections_pages(
        self,
        *,
        max_pages: Optional[int] = None,
        iterator: Optional[str] = None,
        **opts: Any,
    ) -> AsyncIterator[Page]:
        pages = 0
        while max_pages is None or pages < max_pages:
            page = await self.get_following_collections(iterator=iterator, **opts)
            pages += 1
            yield page
            iterator = page.iterator
            if is_exhausted_cursor(iterator):
                return

    async def list_following_collections(
        self, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Collection]:
        items: List[Collection] = []
        async for page in self.get_following_collections_pages(**opts):
            for item in page.items:
                items.append(item)
                if limit is not None and len(items) >= limit:
                    return items
        return items

    async def get_all_following_content(self) -> FollowingContent:
        self._require_token()
        data = await self._request(Q_GET_ALL_FOLLOWING_CONTENT)
        return following_content_from_raw((data or {}).get("getAllFollowingContent") or {})

    async def hide_content(self, content_type: Any, target_id: int) -> HideRule:
        self._require_token()
        data = await self._request(
            Q_HIDE_CONTENT,
            {"data": {"contentType": _validate_content_type(content_type),
                      "targetId": int(target_id)}},
            is_mutation=True,
        )
        rule = ((data or {}).get("hideContent") or {}).get("rule") or {}
        return hide_rule_from_raw(rule)

    async def unhide_content(self, content_type: Any, target_id: int) -> Any:
        self._require_token()
        return await self._request(
            Q_UNHIDE_CONTENT,
            {"data": {"contentType": _validate_content_type(content_type),
                      "targetId": int(target_id)}},
            is_mutation=True,
        )

    async def get_hide_rules(self) -> List[HideRule]:
        self._require_token()
        data = await self._request(Q_GET_HIDE_RULES)
        return [
            hide_rule_from_raw(item)
            for item in ((data or {}).get("getUserHideContentRules") or [])
            if isinstance(item, dict)
        ]

    async def get_hide_rules_with_url(self) -> List[HideRule]:
        self._require_token()
        data = await self._request(Q_GET_HIDE_RULES_WITH_URL)
        return [
            hide_rule_from_raw(item)
            for item in ((data or {}).get("getUserHideContentRulesWithUrl") or [])
            if isinstance(item, dict)
        ]

    async def report_post(self, post_id: int, reason: str, details: Optional[str] = None) -> Any:
        self._require_token()
        return await self._request(
            Q_REPORT_POST,
            {"postId": int(post_id), "reason": reason, "details": details},
            is_mutation=True,
        )

    async def report_user(self, user_id: int, reason: str, details: Optional[str] = None) -> Any:
        self._require_token()
        return await self._request(
            Q_REPORT_USER,
            {"userId": int(user_id), "reason": reason, "details": details},
            is_mutation=True,
        )

    async def report_collection(
        self, collection_id: int, reason: str, details: Optional[str] = None
    ) -> Any:
        self._require_token()
        return await self._request(
            Q_REPORT_COLLECTION,
            {"collectionId": int(collection_id), "reason": reason, "details": details},
            is_mutation=True,
        )

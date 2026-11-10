"""Comment operations (CONTRACT.md §6 rows 6, 7 + T1 §3e).

Readers return PLAIN ARRAYS (no ``{items}`` wrapper): page when
``length < limit`` and chain the cursor from the LAST comment id
(CONTRACT.md §1). Site page sizes: 15 top-level, 3 replies.

Post refs follow the TypeScript core's ``PostRef``: an int id, a bare
numeric string, or a scrolller URL — URLs go through ``ResolveScrolllerLinks``
with :func:`scrolller._ops_base.to_absolute_url` applied (the resolver only
accepts absolute ``https://scrolller.com/...`` URLs), resolved ONCE before
the cursor chain starts.
"""

from __future__ import annotations

from typing import Any, AsyncIterator, Dict, Iterator, List, Optional, Union

from scrolller._graphql import (
    Q_CREATE_COMMENT,
    Q_CREATE_COMMENT_REPLY,
    Q_DELETE_COMMENT,
    Q_GET_COMMENTS,
    Q_GET_REPLIES_FROM_COMMENT,
    Q_LIKE_COMMENT,
    Q_REPORT_COMMENT,
    Q_UNLIKE_COMMENT,
)
from scrolller._models import (
    Comment,
    CreatedComment,
    comment_from_raw,
    created_comment_from_raw,
)

__all__ = ["AsyncCommentOps", "CommentOps"]

PostRef = Union[int, str]

COMMENTS_LIMIT = 15
REPLIES_LIMIT = 3


def _comments_from_data(data: Any, key: str) -> List[Comment]:
    payload = (data or {}).get(key)
    if not isinstance(payload, list):
        return []
    return [comment_from_raw(item) for item in payload if isinstance(item, dict)]


def _comments_page_variables(post_id: int, limit: int, cursor: Optional[int]) -> Dict[str, Any]:
    pagination: Dict[str, Any] = {"limit": int(limit)}
    if cursor is not None:
        pagination["cursor"] = int(cursor)
    return {"post_id": int(post_id), "pagination": pagination}


def _replies_page_variables(comment_id: int, limit: int, cursor: Optional[int]) -> Dict[str, Any]:
    pagination: Dict[str, Any] = {"limit": int(limit)}
    if cursor is not None:
        pagination["cursor"] = int(cursor)
    return {"comment_id": int(comment_id), "pagination": pagination}


class CommentOps:
    """Sync mixin: comment readers + writers."""

    def get_comments(
        self, post_ref: PostRef, *, limit: int = COMMENTS_LIMIT, cursor: Optional[int] = None
    ) -> List[Comment]:
        """Top-level comments of a post (plain array; site page size 15).

        ``post_ref`` is a post id, numeric string, or scrolller post URL
        (relative paths are made absolute before resolving).
        ``cursor`` is the id of the last comment of the previous page.
        """
        post_id = self._resolve_post_id(post_ref)
        return _comments_from_data(
            self._request(Q_GET_COMMENTS, _comments_page_variables(post_id, limit, cursor)),
            "getComments",
        )

    def get_comments_pages(
        self,
        post_ref: PostRef,
        *,
        limit: int = COMMENTS_LIMIT,
        max_pages: Optional[int] = None,
        cursor: Optional[int] = None,
    ) -> Iterator[List[Comment]]:
        post_id = self._resolve_post_id(post_ref)
        pages = 0
        while max_pages is None or pages < max_pages:
            items = _comments_from_data(
                self._request(Q_GET_COMMENTS, _comments_page_variables(post_id, limit, cursor)),
                "getComments",
            )
            pages += 1
            yield items
            if len(items) < int(limit):
                return
            cursor = items[-1].id

    def list_comments(
        self, post_ref: PostRef, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Comment]:
        out: List[Comment] = []
        for page in self.get_comments_pages(post_ref, **opts):
            for comment in page:
                out.append(comment)
                if limit is not None and len(out) >= limit:
                    return out
        return out

    def get_replies_from_comment(
        self, comment_id: int, *, limit: int = REPLIES_LIMIT, cursor: Optional[int] = None
    ) -> List[Comment]:
        """Replies of one comment (plain array; site page size 3)."""
        return _comments_from_data(
            self._request(
                Q_GET_REPLIES_FROM_COMMENT,
                _replies_page_variables(comment_id, limit, cursor),
            ),
            "getRepliesFromComment",
        )

    def get_replies_from_comment_pages(
        self,
        comment_id: int,
        *,
        limit: int = REPLIES_LIMIT,
        max_pages: Optional[int] = None,
        cursor: Optional[int] = None,
    ) -> Iterator[List[Comment]]:
        pages = 0
        while max_pages is None or pages < max_pages:
            items = _comments_from_data(
                self._request(
                    Q_GET_REPLIES_FROM_COMMENT,
                    _replies_page_variables(comment_id, limit, cursor),
                ),
                "getRepliesFromComment",
            )
            pages += 1
            yield items
            if len(items) < int(limit):
                return
            cursor = items[-1].id

    def list_replies_from_comment(
        self, comment_id: int, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Comment]:
        out: List[Comment] = []
        for page in self.get_replies_from_comment_pages(comment_id, **opts):
            for comment in page:
                out.append(comment)
                if limit is not None and len(out) >= limit:
                    return out
        return out

    # -- writes (fail-fast AUTH_REQUIRED without a token) --------------------

    def create_comment(self, post_ref: PostRef, content: str) -> CreatedComment:
        """Comment on a post (createComment). ``post_ref`` is a post id,
        numeric string, or scrolller post URL."""
        self._require_token()
        post_id = self._resolve_post_id(post_ref)
        data = self._request(
            Q_CREATE_COMMENT,
            {"content": content, "post_id": post_id},
            is_mutation=True,
        )
        return created_comment_from_raw((data or {}).get("createComment"))

    def create_comment_reply(self, parent_comment_id: int, content: str) -> CreatedComment:
        """Reply to a comment (createCommentReply)."""
        self._require_token()
        data = self._request(
            Q_CREATE_COMMENT_REPLY,
            {"content": content, "parent_comment_id": int(parent_comment_id)},
            is_mutation=True,
        )
        return created_comment_from_raw((data or {}).get("createCommentReply"))

    def like_comment(self, comment_id: int) -> Any:
        self._require_token()
        return self._request(Q_LIKE_COMMENT, {"id": int(comment_id)}, is_mutation=True)

    def unlike_comment(self, comment_id: int) -> Any:
        self._require_token()
        return self._request(Q_UNLIKE_COMMENT, {"id": int(comment_id)}, is_mutation=True)

    def delete_comment(self, comment_id: int) -> CreatedComment:
        self._require_token()
        data = self._request(Q_DELETE_COMMENT, {"id": int(comment_id)}, is_mutation=True)
        return created_comment_from_raw((data or {}).get("deleteComment"))

    def report_comment(self, comment_id: int, reason: str, details: Optional[str] = None) -> Any:
        self._require_token()
        return self._request(
            Q_REPORT_COMMENT,
            {"commentId": int(comment_id), "reason": reason, "details": details},
            is_mutation=True,
        )


class AsyncCommentOps:
    """Async mirror of :class:`CommentOps`."""

    async def get_comments(
        self, post_ref: PostRef, *, limit: int = COMMENTS_LIMIT, cursor: Optional[int] = None
    ) -> List[Comment]:
        post_id = await self._resolve_post_id(post_ref)
        return _comments_from_data(
            await self._request(Q_GET_COMMENTS, _comments_page_variables(post_id, limit, cursor)),
            "getComments",
        )

    async def get_comments_pages(
        self,
        post_ref: PostRef,
        *,
        limit: int = COMMENTS_LIMIT,
        max_pages: Optional[int] = None,
        cursor: Optional[int] = None,
    ) -> AsyncIterator[List[Comment]]:
        post_id = await self._resolve_post_id(post_ref)
        pages = 0
        while max_pages is None or pages < max_pages:
            items = _comments_from_data(
                await self._request(
                    Q_GET_COMMENTS, _comments_page_variables(post_id, limit, cursor)
                ),
                "getComments",
            )
            pages += 1
            yield items
            if len(items) < int(limit):
                return
            cursor = items[-1].id

    async def list_comments(
        self, post_ref: PostRef, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Comment]:
        out: List[Comment] = []
        async for page in self.get_comments_pages(post_ref, **opts):
            for comment in page:
                out.append(comment)
                if limit is not None and len(out) >= limit:
                    return out
        return out

    async def get_replies_from_comment(
        self, comment_id: int, *, limit: int = REPLIES_LIMIT, cursor: Optional[int] = None
    ) -> List[Comment]:
        return _comments_from_data(
            await self._request(
                Q_GET_REPLIES_FROM_COMMENT,
                _replies_page_variables(comment_id, limit, cursor),
            ),
            "getRepliesFromComment",
        )

    async def get_replies_from_comment_pages(
        self,
        comment_id: int,
        *,
        limit: int = REPLIES_LIMIT,
        max_pages: Optional[int] = None,
        cursor: Optional[int] = None,
    ) -> AsyncIterator[List[Comment]]:
        pages = 0
        while max_pages is None or pages < max_pages:
            items = _comments_from_data(
                await self._request(
                    Q_GET_REPLIES_FROM_COMMENT,
                    _replies_page_variables(comment_id, limit, cursor),
                ),
                "getRepliesFromComment",
            )
            pages += 1
            yield items
            if len(items) < int(limit):
                return
            cursor = items[-1].id

    async def list_replies_from_comment(
        self, comment_id: int, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Comment]:
        out: List[Comment] = []
        async for page in self.get_replies_from_comment_pages(comment_id, **opts):
            for comment in page:
                out.append(comment)
                if limit is not None and len(out) >= limit:
                    return out
        return out

    async def create_comment(self, post_ref: PostRef, content: str) -> CreatedComment:
        self._require_token()
        post_id = await self._resolve_post_id(post_ref)
        data = await self._request(
            Q_CREATE_COMMENT, {"content": content, "post_id": post_id}, is_mutation=True
        )
        return created_comment_from_raw((data or {}).get("createComment"))

    async def create_comment_reply(self, parent_comment_id: int, content: str) -> CreatedComment:
        self._require_token()
        data = await self._request(
            Q_CREATE_COMMENT_REPLY,
            {"content": content, "parent_comment_id": int(parent_comment_id)},
            is_mutation=True,
        )
        return created_comment_from_raw((data or {}).get("createCommentReply"))

    async def like_comment(self, comment_id: int) -> Any:
        self._require_token()
        return await self._request(Q_LIKE_COMMENT, {"id": int(comment_id)}, is_mutation=True)

    async def unlike_comment(self, comment_id: int) -> Any:
        self._require_token()
        return await self._request(Q_UNLIKE_COMMENT, {"id": int(comment_id)}, is_mutation=True)

    async def delete_comment(self, comment_id: int) -> CreatedComment:
        self._require_token()
        data = await self._request(Q_DELETE_COMMENT, {"id": int(comment_id)}, is_mutation=True)
        return created_comment_from_raw((data or {}).get("deleteComment"))

    async def report_comment(
        self, comment_id: int, reason: str, details: Optional[str] = None
    ) -> Any:
        self._require_token()
        return await self._request(
            Q_REPORT_COMMENT,
            {"commentId": int(comment_id), "reason": reason, "details": details},
            is_mutation=True,
        )

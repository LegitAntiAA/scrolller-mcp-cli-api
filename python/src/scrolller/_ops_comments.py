"""Comment operations (CONTRACT.md §6 rows 6, 7 + T1 §3e).

Readers return PLAIN ARRAYS (no ``{items}`` wrapper): page when
``length < limit`` and chain the cursor from the LAST comment id
(CONTRACT.md §1). Site page sizes: 15 top-level, 3 replies.
"""

from __future__ import annotations

from typing import Any, AsyncIterator, Dict, Iterator, List, Optional

from scrolller._errors import ScrolllerError
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
    created_comment_from_raw,
    comment_from_raw,
)

__all__ = ["AsyncCommentOps", "CommentOps"]


def _comments_from_data(data: Any, key: str) -> List[Comment]:
    payload = (data or {}).get(key)
    if not isinstance(payload, list):
        return []
    return [comment_from_raw(item) for item in payload if isinstance(item, dict)]


def _post_id_from_ref(ref: Any) -> int:
    """Validate a numeric post id (URLs are resolved by the caller)."""
    if isinstance(ref, int) and not isinstance(ref, bool):
        return ref
    raise ScrolllerError("post ref must be a post id (int) or a scrolller post URL")


def _post_id_error(ref: Any) -> ScrolllerError:
    return ScrolllerError(f"cannot resolve a post id from {ref!r}")


class CommentOps:
    """Sync mixin: comment readers + writers."""

    def get_comments(
        self, post_id: int, *, limit: int = 15, cursor: Optional[int] = None
    ) -> List[Comment]:
        """Top-level comments of a post (plain array; site page size 15).

        ``cursor`` is the id of the last comment of the previous page.
        """
        variables: Dict[str, Any] = {
            "post_id": int(post_id),
            "pagination": {"limit": int(limit)},
        }
        if cursor is not None:
            variables["pagination"]["cursor"] = int(cursor)
        return _comments_from_data(self._request(Q_GET_COMMENTS, variables), "getComments")

    def get_comments_pages(
        self,
        post_id: int,
        *,
        limit: int = 15,
        max_pages: Optional[int] = None,
        cursor: Optional[int] = None,
    ) -> Iterator[List[Comment]]:
        pages = 0
        while max_pages is None or pages < max_pages:
            items = self.get_comments(post_id, limit=limit, cursor=cursor)
            pages += 1
            yield items
            if len(items) < int(limit):
                return
            cursor = items[-1].id

    def list_comments(
        self, post_id: int, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Comment]:
        out: List[Comment] = []
        for page in self.get_comments_pages(post_id, **opts):
            for comment in page:
                out.append(comment)
                if limit is not None and len(out) >= limit:
                    return out
        return out

    def get_replies_from_comment(
        self, comment_id: int, *, limit: int = 3, cursor: Optional[int] = None
    ) -> List[Comment]:
        """Replies of one comment (plain array; site page size 3)."""
        variables: Dict[str, Any] = {
            "comment_id": int(comment_id),
            "pagination": {"limit": int(limit)},
        }
        if cursor is not None:
            variables["pagination"]["cursor"] = int(cursor)
        return _comments_from_data(
            self._request(Q_GET_REPLIES_FROM_COMMENT, variables), "getRepliesFromComment"
        )

    def get_replies_from_comment_pages(
        self,
        comment_id: int,
        *,
        limit: int = 3,
        max_pages: Optional[int] = None,
        cursor: Optional[int] = None,
    ) -> Iterator[List[Comment]]:
        pages = 0
        while max_pages is None or pages < max_pages:
            items = self.get_replies_from_comment(comment_id, limit=limit, cursor=cursor)
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

    def create_comment(self, post_ref: Any, content: str) -> CreatedComment:
        """Comment on a post (createComment). ``post_ref`` is a post id or URL."""
        self._require_token()
        if isinstance(post_ref, str):
            link = self.resolve_link(post_ref)
            if link is None or link.post is None or link.post.id is None:
                raise _post_id_error(post_ref)
            post_id = int(link.post.id)
        else:
            post_id = _post_id_from_ref(post_ref)
        data = self._request(Q_CREATE_COMMENT, {"content": content, "post_id": post_id},
                             is_mutation=True)
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
        self, post_id: int, *, limit: int = 15, cursor: Optional[int] = None
    ) -> List[Comment]:
        variables: Dict[str, Any] = {
            "post_id": int(post_id),
            "pagination": {"limit": int(limit)},
        }
        if cursor is not None:
            variables["pagination"]["cursor"] = int(cursor)
        return _comments_from_data(await self._request(Q_GET_COMMENTS, variables), "getComments")

    async def get_comments_pages(
        self,
        post_id: int,
        *,
        limit: int = 15,
        max_pages: Optional[int] = None,
        cursor: Optional[int] = None,
    ) -> AsyncIterator[List[Comment]]:
        pages = 0
        while max_pages is None or pages < max_pages:
            items = await self.get_comments(post_id, limit=limit, cursor=cursor)
            pages += 1
            yield items
            if len(items) < int(limit):
                return
            cursor = items[-1].id

    async def list_comments(
        self, post_id: int, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Comment]:
        out: List[Comment] = []
        async for page in self.get_comments_pages(post_id, **opts):
            for comment in page:
                out.append(comment)
                if limit is not None and len(out) >= limit:
                    return out
        return out

    async def get_replies_from_comment(
        self, comment_id: int, *, limit: int = 3, cursor: Optional[int] = None
    ) -> List[Comment]:
        variables: Dict[str, Any] = {
            "comment_id": int(comment_id),
            "pagination": {"limit": int(limit)},
        }
        if cursor is not None:
            variables["pagination"]["cursor"] = int(cursor)
        return _comments_from_data(
            await self._request(Q_GET_REPLIES_FROM_COMMENT, variables), "getRepliesFromComment"
        )

    async def get_replies_from_comment_pages(
        self,
        comment_id: int,
        *,
        limit: int = 3,
        max_pages: Optional[int] = None,
        cursor: Optional[int] = None,
    ) -> AsyncIterator[List[Comment]]:
        pages = 0
        while max_pages is None or pages < max_pages:
            items = await self.get_replies_from_comment(comment_id, limit=limit, cursor=cursor)
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

    async def create_comment(self, post_ref: Any, content: str) -> CreatedComment:
        self._require_token()
        if isinstance(post_ref, str):
            link = await self.resolve_link(post_ref)
            if link is None or link.post is None or link.post.id is None:
                raise _post_id_error(post_ref)
            post_id = int(link.post.id)
        else:
            post_id = _post_id_from_ref(post_ref)
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

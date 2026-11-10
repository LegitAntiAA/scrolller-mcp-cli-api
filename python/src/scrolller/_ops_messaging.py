"""Notifications + direct messages (CONTRACT.md §6 rows 17–18 + T1 §3f/§3g).

All operations are 🔒 — fail-fast ``AUTH_REQUIRED`` without a token
(CONTRACT.md §5.1). Pagination follows T1 §6: notifications and messages use
a numeric ``page`` (stop on a short page); conversations use the opaque
``next_cursor`` string (passed back byte-exact).
"""

from __future__ import annotations

from typing import Any, AsyncIterator, Dict, Iterator, List, Optional, Union

from scrolller._errors import ScrolllerError
from scrolller._graphql import (
    Q_GET_CONVERSATIONS,
    Q_GET_MESSAGES,
    Q_GET_NOTIFICATIONS,
    Q_GET_TOTAL_UNREAD_COUNT,
    Q_MARK_ALL_NOTIFICATIONS_AS_READ,
    Q_MARK_MESSAGES_AS_READ,
    Q_MARK_NOTIFICATION_AS_ARCHIVED,
    Q_MARK_NOTIFICATION_AS_UNARCHIVED,
    Q_SEND_MESSAGE,
)
from scrolller._models import (
    Conversation,
    ConversationsPage,
    Message,
    MessagesPage,
    Notification,
    conversation_from_raw,
    is_exhausted_cursor,
    message_from_raw,
    notification_from_raw,
)

__all__ = ["AsyncMessagingOps", "MessagingOps"]

# Site defaults (T1 §6): notifications {page:1, limit:30}; conversations
# limit 20; messages numeric page.
DEFAULT_NOTIFICATIONS_LIMIT = 30
DEFAULT_CONVERSATIONS_LIMIT = 20
DEFAULT_MESSAGES_LIMIT = 20

NotificationsFilter = Optional[str]  # bundle-inferred: "ALL" | "ARCHIVED" (T1 §4)
ConversationRef = Union[int, Conversation]  # other-user id or a conversations() row


def _conversation_user_id(ref: ConversationRef) -> int:
    """Accept a conversation object (from ``get_conversations``) or a bare
    other-user id (parity with the TypeScript ``conversationUserId``)."""
    if isinstance(ref, bool):
        raise ScrolllerError("conversation ref must be a user id (int) or a Conversation")
    if isinstance(ref, int):
        return int(ref)
    user = getattr(ref, "user", None)
    user_id = getattr(user, "id", None) if user is not None else None
    if isinstance(user_id, int) and not isinstance(user_id, bool):
        return user_id
    raise ScrolllerError("conversation has no numeric user id; pass the other user's id directly")


class MessagingOps:
    """Sync mixin: notifications + conversations/messages."""

    # -- notifications (numeric page, T1 §3g) ---------------------------------

    def get_notifications(
        self,
        *,
        page: int = 1,
        limit: int = DEFAULT_NOTIFICATIONS_LIMIT,
        filter: NotificationsFilter = None,  # noqa: A002 — bundle-inferred input field
    ) -> List[Notification]:
        """One notifications page (NotificationsQuery; site default limit 30).

        ``filter`` is a bundle-inferred input field (``"ALL" | "ARCHIVED"``,
        T1 §4); it is omitted when ``None``. The client-side site filters
        ``viewedAt``/``archivedAt`` itself — no server filter is documented
        beyond the inferred one.
        """
        self._require_token()
        data: Dict[str, Any] = {"pagination": {"page": int(page), "limit": int(limit)}}
        if filter is not None:
            data["filter"] = filter
        payload = self._request(Q_GET_NOTIFICATIONS, {"data": data})
        return [
            notification_from_raw(item)
            for item in (payload or [])
            if isinstance(item, dict)
        ]

    def get_notifications_pages(
        self,
        *,
        page: int = 1,
        limit: int = DEFAULT_NOTIFICATIONS_LIMIT,
        max_pages: Optional[int] = None,
        filter: NotificationsFilter = None,  # noqa: A002
    ) -> Iterator[List[Notification]]:
        pages = 0
        current = int(page)
        while max_pages is None or pages < max_pages:
            items = self.get_notifications(page=current, limit=limit, filter=filter)
            pages += 1
            yield items
            if len(items) < int(limit):
                return
            current += 1

    def list_notifications(
        self, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Notification]:
        out: List[Notification] = []
        for page in self.get_notifications_pages(**opts):
            for notification in page:
                out.append(notification)
                if limit is not None and len(out) >= limit:
                    return out
        return out

    def mark_all_notifications_as_read(self) -> Any:
        self._require_token()
        return self._request(Q_MARK_ALL_NOTIFICATIONS_AS_READ, is_mutation=True)

    def mark_notification_as_archived(self, notification_id: int) -> Any:
        self._require_token()
        return self._request(
            Q_MARK_NOTIFICATION_AS_ARCHIVED, {"id": int(notification_id)}, is_mutation=True
        )

    def mark_notification_as_unarchived(self, notification_id: int) -> Any:
        self._require_token()
        return self._request(
            Q_MARK_NOTIFICATION_AS_UNARCHIVED, {"id": int(notification_id)}, is_mutation=True
        )

    # -- conversations (opaque next_cursor, T1 §3f) ---------------------------

    def get_conversations(
        self,
        *,
        limit: int = DEFAULT_CONVERSATIONS_LIMIT,
        cursor: Optional[str] = None,
    ) -> ConversationsPage:
        """One conversations page; continue with the returned ``next_cursor``."""
        self._require_token()
        data: Dict[str, Any] = {"limit": int(limit)}
        if not is_exhausted_cursor(cursor):
            data["cursor"] = cursor
        payload = self._request(Q_GET_CONVERSATIONS, {"data": data}) or {}
        return ConversationsPage(
            items=[
                conversation_from_raw(item)
                for item in (payload.get("items") or [])
                if isinstance(item, dict)
            ],
            next_cursor=payload.get("next_cursor"),
            raw=dict(payload),
        )

    def get_conversations_pages(
        self,
        *,
        limit: int = DEFAULT_CONVERSATIONS_LIMIT,
        cursor: Optional[str] = None,
        max_pages: Optional[int] = None,
    ) -> Iterator[ConversationsPage]:
        pages = 0
        while max_pages is None or pages < max_pages:
            page = self.get_conversations(limit=limit, cursor=cursor)
            pages += 1
            yield page
            cursor = page.next_cursor
            if is_exhausted_cursor(cursor):
                return

    def list_conversations(
        self, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Conversation]:
        out: List[Conversation] = []
        for page in self.get_conversations_pages(**opts):
            for conversation in page.items:
                out.append(conversation)
                if limit is not None and len(out) >= limit:
                    return out
        return out

    # -- messages (numeric page keyed by the other user's id) ------------------

    def get_messages(
        self,
        conversation: ConversationRef,
        *,
        page: int = 1,
        limit: int = DEFAULT_MESSAGES_LIMIT,
    ) -> MessagesPage:
        """One messages page of a conversation (getMessages).

        ``conversation`` is the other user's numeric id or a
        :class:`scrolller.Conversation` row from :meth:`get_conversations`.
        """
        self._require_token()
        other_user_id = _conversation_user_id(conversation)
        variables = {"data": {"other_user_id": other_user_id, "limit": int(limit), "page": int(page)}}
        payload = self._request(Q_GET_MESSAGES, variables) or {}
        return MessagesPage(
            items=[
                message_from_raw(item)
                for item in (payload.get("items") or [])
                if isinstance(item, dict)
            ],
            total=payload.get("total"),
            raw=dict(payload),
        )

    def get_messages_pages(
        self,
        conversation: ConversationRef,
        *,
        page: int = 1,
        limit: int = DEFAULT_MESSAGES_LIMIT,
        max_pages: Optional[int] = None,
    ) -> Iterator[MessagesPage]:
        current = int(page)
        pages = 0
        while max_pages is None or pages < max_pages:
            result = self.get_messages(conversation, page=current, limit=limit)
            pages += 1
            yield result
            if len(result.items) < int(limit):
                return
            total = result.total
            if isinstance(total, int) and current * int(limit) >= total:
                return
            current += 1

    def list_messages(
        self, conversation: ConversationRef, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Message]:
        out: List[Message] = []
        for page in self.get_messages_pages(conversation, **opts):
            for message in page.items:
                out.append(message)
                if limit is not None and len(out) >= limit:
                    return out
        return out

    # -- writes ----------------------------------------------------------------

    def send_message(self, receiver_id: int, content: str) -> Message:
        """Send a direct message (SendMessage). ``receiver_id`` is the other
        user's numeric id."""
        self._require_token()
        variables = {"data": {"receiver_id": int(receiver_id), "content": content}}
        payload = self._request(Q_SEND_MESSAGE, variables, is_mutation=True)
        return message_from_raw(payload if isinstance(payload, dict) else {})

    def mark_messages_as_read(self, sender_id: int) -> Any:
        """Mark all messages from ``sender_id`` as read (MarkMessagesAsRead)."""
        self._require_token()
        return self._request(Q_MARK_MESSAGES_AS_READ, {"sender_id": int(sender_id)}, is_mutation=True)

    def get_total_unread_count(self) -> Optional[int]:
        """Total unread message count (GetTotalUnreadCount); ``None`` if absent."""
        self._require_token()
        payload = self._request(Q_GET_TOTAL_UNREAD_COUNT)
        return payload if isinstance(payload, int) and not isinstance(payload, bool) else None


class AsyncMessagingOps:
    """Async mirror of :class:`MessagingOps`."""

    async def get_notifications(
        self,
        *,
        page: int = 1,
        limit: int = DEFAULT_NOTIFICATIONS_LIMIT,
        filter: NotificationsFilter = None,  # noqa: A002
    ) -> List[Notification]:
        self._require_token()
        data: Dict[str, Any] = {"pagination": {"page": int(page), "limit": int(limit)}}
        if filter is not None:
            data["filter"] = filter
        payload = await self._request(Q_GET_NOTIFICATIONS, {"data": data})
        return [
            notification_from_raw(item)
            for item in (payload or [])
            if isinstance(item, dict)
        ]

    async def get_notifications_pages(
        self,
        *,
        page: int = 1,
        limit: int = DEFAULT_NOTIFICATIONS_LIMIT,
        max_pages: Optional[int] = None,
        filter: NotificationsFilter = None,  # noqa: A002
    ) -> AsyncIterator[List[Notification]]:
        pages = 0
        current = int(page)
        while max_pages is None or pages < max_pages:
            items = await self.get_notifications(page=current, limit=limit, filter=filter)
            pages += 1
            yield items
            if len(items) < int(limit):
                return
            current += 1

    async def list_notifications(
        self, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Notification]:
        out: List[Notification] = []
        async for page in self.get_notifications_pages(**opts):
            for notification in page:
                out.append(notification)
                if limit is not None and len(out) >= limit:
                    return out
        return out

    async def mark_all_notifications_as_read(self) -> Any:
        self._require_token()
        return await self._request(Q_MARK_ALL_NOTIFICATIONS_AS_READ, is_mutation=True)

    async def mark_notification_as_archived(self, notification_id: int) -> Any:
        self._require_token()
        return await self._request(
            Q_MARK_NOTIFICATION_AS_ARCHIVED, {"id": int(notification_id)}, is_mutation=True
        )

    async def mark_notification_as_unarchived(self, notification_id: int) -> Any:
        self._require_token()
        return await self._request(
            Q_MARK_NOTIFICATION_AS_UNARCHIVED, {"id": int(notification_id)}, is_mutation=True
        )

    async def get_conversations(
        self,
        *,
        limit: int = DEFAULT_CONVERSATIONS_LIMIT,
        cursor: Optional[str] = None,
    ) -> ConversationsPage:
        self._require_token()
        data: Dict[str, Any] = {"limit": int(limit)}
        if not is_exhausted_cursor(cursor):
            data["cursor"] = cursor
        payload = (await self._request(Q_GET_CONVERSATIONS, {"data": data})) or {}
        return ConversationsPage(
            items=[
                conversation_from_raw(item)
                for item in (payload.get("items") or [])
                if isinstance(item, dict)
            ],
            next_cursor=payload.get("next_cursor"),
            raw=dict(payload),
        )

    async def get_conversations_pages(
        self,
        *,
        limit: int = DEFAULT_CONVERSATIONS_LIMIT,
        cursor: Optional[str] = None,
        max_pages: Optional[int] = None,
    ) -> AsyncIterator[ConversationsPage]:
        pages = 0
        while max_pages is None or pages < max_pages:
            page = await self.get_conversations(limit=limit, cursor=cursor)
            pages += 1
            yield page
            cursor = page.next_cursor
            if is_exhausted_cursor(cursor):
                return

    async def list_conversations(
        self, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Conversation]:
        out: List[Conversation] = []
        async for page in self.get_conversations_pages(**opts):
            for conversation in page.items:
                out.append(conversation)
                if limit is not None and len(out) >= limit:
                    return out
        return out

    async def get_messages(
        self,
        conversation: ConversationRef,
        *,
        page: int = 1,
        limit: int = DEFAULT_MESSAGES_LIMIT,
    ) -> MessagesPage:
        self._require_token()
        other_user_id = _conversation_user_id(conversation)
        variables = {"data": {"other_user_id": other_user_id, "limit": int(limit), "page": int(page)}}
        payload = (await self._request(Q_GET_MESSAGES, variables)) or {}
        return MessagesPage(
            items=[
                message_from_raw(item)
                for item in (payload.get("items") or [])
                if isinstance(item, dict)
            ],
            total=payload.get("total"),
            raw=dict(payload),
        )

    async def get_messages_pages(
        self,
        conversation: ConversationRef,
        *,
        page: int = 1,
        limit: int = DEFAULT_MESSAGES_LIMIT,
        max_pages: Optional[int] = None,
    ) -> AsyncIterator[MessagesPage]:
        current = int(page)
        pages = 0
        while max_pages is None or pages < max_pages:
            result = await self.get_messages(conversation, page=current, limit=limit)
            pages += 1
            yield result
            if len(result.items) < int(limit):
                return
            total = result.total
            if isinstance(total, int) and current * int(limit) >= total:
                return
            current += 1

    async def list_messages(
        self, conversation: ConversationRef, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Message]:
        out: List[Message] = []
        async for page in self.get_messages_pages(conversation, **opts):
            for message in page.items:
                out.append(message)
                if limit is not None and len(out) >= limit:
                    return out
        return out

    async def send_message(self, receiver_id: int, content: str) -> Message:
        self._require_token()
        variables = {"data": {"receiver_id": int(receiver_id), "content": content}}
        payload = await self._request(Q_SEND_MESSAGE, variables, is_mutation=True)
        return message_from_raw(payload if isinstance(payload, dict) else {})

    async def mark_messages_as_read(self, sender_id: int) -> Any:
        self._require_token()
        return await self._request(
            Q_MARK_MESSAGES_AS_READ, {"sender_id": int(sender_id)}, is_mutation=True
        )

    async def get_total_unread_count(self) -> Optional[int]:
        self._require_token()
        payload = await self._request(Q_GET_TOTAL_UNREAD_COUNT)
        return payload if isinstance(payload, int) and not isinstance(payload, bool) else None

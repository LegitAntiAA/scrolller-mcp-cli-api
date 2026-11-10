"""User-collection operations (CONTRACT.md §6 rows 11–14 + T1 §3c).

Includes the creator/lazy-chunk operations (editCustomCollection,
preview-url and billing-options mutations). All are fail-fast
AUTH_REQUIRED without a token; the raw-dict returns are documented
per method.
"""

from __future__ import annotations

from typing import Any, AsyncIterator, Dict, Iterator, List, Optional

from scrolller._graphql import (
    Q_ADD_COLLECTION_IMPRESSION,
    Q_ADD_POST_TO_COLLECTION,
    Q_CREATE_COLLECTION,
    Q_CREATE_COLLECTION_BILLING_OPTIONS,
    Q_DEACTIVATE_COLLECTION_BILLING_OPTIONS,
    Q_DELETE_COLLECTION,
    Q_DELETE_COLLECTION_PREVIEW_URL,
    Q_DELETE_CUSTOM_COLLECTION,
    Q_EDIT_COLLECTION,
    Q_EDIT_COLLECTION_PREVIEW_URL,
    Q_EDIT_CUSTOM_COLLECTION,
    Q_GET_COLLECTION_BY_ID,
    Q_GET_COLLECTION_SETUP,
    Q_GET_USER_COLLECTION,
    Q_GET_USER_COLLECTION_CONTENT,
    Q_GET_USER_COLLECTIONS,
    Q_REMOVE_POST_FROM_COLLECTION,
    enum_value,
    paid_collections_document,
)
from scrolller._models import (
    Collection,
    CollectionSetup,
    Page,
    Subreddit,
    collection_from_raw,
    collection_setup_from_raw,
    is_exhausted_cursor,
    page_from_raw,
    post_from_raw,
    subreddit_from_raw,
)

__all__ = ["AsyncCollectionOps", "CollectionOps"]


class CollectionOps:
    """Sync mixin: user collections."""

    def list_collections(self) -> List[Collection]:
        """The signed-in user's collections (GetUserCollectionsQuery)."""
        self._require_token()
        data = self._request(Q_GET_USER_COLLECTIONS)
        return [
            collection_from_raw(item)
            for item in ((data or {}).get("getUserCollections") or [])
            if isinstance(item, dict)
        ]

    def get_collection(self, collection_id: int) -> Collection:
        """Collection by numeric id (GetCollectionById)."""
        self._require_token()
        data = self._request(Q_GET_COLLECTION_BY_ID, {"collectionId": int(collection_id)})
        return collection_from_raw((data or {}).get("getCollection") or {})

    def get_collection_by_url(self, url: str) -> Collection:
        """Collection by its scrolller URL (GetUserCollectionQuery)."""
        self._require_token()
        data = self._request(Q_GET_USER_COLLECTION, {"url": url})
        return collection_from_raw((data or {}).get("getUserCollection") or {})

    def get_collection_content(
        self,
        collection_id: int,
        *,
        limit: int = 50,
        iterator: Optional[str] = None,
        sort_by: Any = None,
        filter: Any = None,  # noqa: A002 — GraphQL argument name
        nsfw: Any = None,
    ) -> Page:
        """Posts inside a collection (getUserCollectionContentQuery)."""
        self._require_token()
        variables = {
            "collectionId": int(collection_id),
            "iterator": iterator,
            "filter": enum_value(filter),
            "sortBy": enum_value(sort_by),
            "limit": int(limit),
            "nsfw": self._nsfw_value(nsfw),
        }
        data = self._request(Q_GET_USER_COLLECTION_CONTENT, variables)
        return page_from_raw((data or {}).get("getUserCollectionContent"), post_from_raw)

    def get_collection_content_pages(
        self,
        collection_id: int,
        *,
        max_pages: Optional[int] = None,
        iterator: Optional[str] = None,
        **opts: Any,
    ) -> Iterator[Page]:
        pages = 0
        while max_pages is None or pages < max_pages:
            page = self.get_collection_content(collection_id, iterator=iterator, **opts)
            pages += 1
            yield page
            iterator = page.iterator
            if is_exhausted_cursor(iterator):
                return

    def list_collection_content(
        self, collection_id: int, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Any]:
        items: List[Any] = []
        for page in self.get_collection_content_pages(collection_id, **opts):
            for post in page.items:
                items.append(post)
                if limit is not None and len(items) >= limit:
                    return items
        return items

    def create_collection(
        self,
        title: str,
        *,
        description: Optional[str] = None,
        is_private: bool = False,
        is_nsfw: bool = False,
    ) -> Collection:
        """Create a collection (CreateCollection)."""
        self._require_token()
        variables = {
            "title": title,
            "description": description,
            "is_private": bool(is_private),
            "is_nsfw": bool(is_nsfw),
        }
        data = self._request(Q_CREATE_COLLECTION, variables, is_mutation=True)
        return collection_from_raw((data or {}).get("createCollection") or {})

    def edit_collection(
        self,
        collection_id: int,
        title: str,
        *,
        description: Optional[str] = None,
        is_private: bool = False,
        is_nsfw: bool = False,
    ) -> Collection:
        """Edit title/description/visibility of a collection (EditCollection)."""
        self._require_token()
        variables = {
            "id": int(collection_id),
            "title": title,
            "description": description,
            "is_private": bool(is_private),
            "is_nsfw": bool(is_nsfw),
        }
        data = self._request(Q_EDIT_COLLECTION, variables, is_mutation=True)
        return collection_from_raw((data or {}).get("editCollection") or {})

    def delete_collection(self, collection_id: int) -> Any:
        self._require_token()
        return self._request(
            Q_DELETE_COLLECTION, {"id": int(collection_id)}, is_mutation=True
        )

    def add_to_collection(self, post_id: int, collection_id: int) -> Any:
        self._require_token()
        return self._request(
            Q_ADD_POST_TO_COLLECTION,
            {"postId": int(post_id), "collectionId": int(collection_id)},
            is_mutation=True,
        )

    def remove_from_collection(self, post_id: int, collection_id: int) -> Any:
        self._require_token()
        return self._request(
            Q_REMOVE_POST_FROM_COLLECTION,
            {"postId": int(post_id), "collectionId": int(collection_id)},
            is_mutation=True,
        )

    def get_collection_setup(self, collection_id: int) -> CollectionSetup:
        """Paid-collection setup: collection/offer/owner/hasAccess/status."""
        self._require_token()
        data = self._request(Q_GET_COLLECTION_SETUP, {"collectionId": int(collection_id)})
        return collection_setup_from_raw((data or {}).get("getCollectionSetup") or {})

    def paid_collections(
        self,
        *,
        limit: int = 10,
        is_nsfw: bool = False,
        iterator: Optional[str] = None,
    ) -> Page:
        """The signed-in user's paid collections (PaidCollections).

        ``limit``/``isNsfw`` are interpolated literals in the document
        (site defaults: limit 10, isNsfw false) — T1 §3c.
        """
        self._require_token()
        data = self._request(
            paid_collections_document(limit=limit, is_nsfw=is_nsfw), {"iterator": iterator}
        )
        return page_from_raw((data or {}).get("getMyPaidCollections"), subreddit_from_raw)

    def paid_collections_pages(
        self,
        *,
        max_pages: Optional[int] = None,
        iterator: Optional[str] = None,
        limit: int = 10,
        is_nsfw: bool = False,
    ) -> Iterator[Page]:
        pages = 0
        while max_pages is None or pages < max_pages:
            page = self.paid_collections(limit=limit, is_nsfw=is_nsfw, iterator=iterator)
            pages += 1
            yield page
            iterator = page.iterator
            if is_exhausted_cursor(iterator):
                return

    def list_paid_collections(
        self, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Subreddit]:
        items: List[Subreddit] = []
        for page in self.paid_collections_pages(**opts):
            for item in page.items:
                items.append(item)
                if limit is not None and len(items) >= limit:
                    return items
        return items

    # -- creator/lazy-chunk operations (raw dict/scalar returns) -------------

    def edit_custom_collection(
        self,
        collection_id: int,
        url: str,
        title: str,
        *,
        description: Optional[str] = None,
        tags: str = "",
        is_paid: bool = False,
        is_private: bool = False,
    ) -> Dict[str, Any]:
        """Creator edit of a paid subreddit-collection (editSubreddit).

        Returns the raw response data ``{id, previewUrl, url}``.
        """
        self._require_token()
        variables = {
            "id": int(collection_id),
            "url": url,
            "title": title,
            "description": description,
            "tags": tags,
            "isPaid": bool(is_paid),
            "isPrivate": bool(is_private),
        }
        return self._request(Q_EDIT_CUSTOM_COLLECTION, variables, is_mutation=True) or {}

    def delete_custom_collection(self, collection_url: str) -> Any:
        self._require_token()
        return self._request(
            Q_DELETE_CUSTOM_COLLECTION, {"collectionUrl": collection_url}, is_mutation=True
        )

    def edit_collection_preview_url(self, collection_url: str, preview_url: str) -> Dict[str, Any]:
        self._require_token()
        return self._request(
            Q_EDIT_COLLECTION_PREVIEW_URL,
            {"collectionUrl": collection_url, "previewUrl": preview_url},
            is_mutation=True,
        ) or {}

    def delete_collection_preview_url(self, collection_id: int) -> Any:
        self._require_token()
        return self._request(
            Q_DELETE_COLLECTION_PREVIEW_URL, {"collectionId": int(collection_id)},
            is_mutation=True,
        )

    def create_collection_billing_options(
        self, collection_id: int, amount: float, type: str  # noqa: A002 — GraphQL arg name
    ) -> Any:
        self._require_token()
        return self._request(
            Q_CREATE_COLLECTION_BILLING_OPTIONS,
            {"collectionId": int(collection_id), "amount": float(amount), "type": type},
            is_mutation=True,
        )

    def deactivate_collection_billing_options(self, collection_id: int) -> Any:
        self._require_token()
        return self._request(
            Q_DEACTIVATE_COLLECTION_BILLING_OPTIONS, {"collectionId": int(collection_id)},
            is_mutation=True,
        )

    def add_collection_impression(
        self,
        *,
        subreddit_url: Optional[str] = None,
        collection_id: Optional[int] = None,
    ) -> Any:
        """Impression tracking (anonymous-safe; server backstop on auth)."""
        variables = {
            "subredditUrl": subreddit_url,
            "collectionId": int(collection_id) if collection_id is not None else None,
        }
        return self._request(Q_ADD_COLLECTION_IMPRESSION, variables, is_mutation=True)


class AsyncCollectionOps:
    """Async mirror of :class:`CollectionOps`."""

    async def list_collections(self) -> List[Collection]:
        self._require_token()
        data = await self._request(Q_GET_USER_COLLECTIONS)
        return [
            collection_from_raw(item)
            for item in ((data or {}).get("getUserCollections") or [])
            if isinstance(item, dict)
        ]

    async def get_collection(self, collection_id: int) -> Collection:
        self._require_token()
        data = await self._request(Q_GET_COLLECTION_BY_ID, {"collectionId": int(collection_id)})
        return collection_from_raw((data or {}).get("getCollection") or {})

    async def get_collection_by_url(self, url: str) -> Collection:
        self._require_token()
        data = await self._request(Q_GET_USER_COLLECTION, {"url": url})
        return collection_from_raw((data or {}).get("getUserCollection") or {})

    async def get_collection_content(
        self,
        collection_id: int,
        *,
        limit: int = 50,
        iterator: Optional[str] = None,
        sort_by: Any = None,
        filter: Any = None,  # noqa: A002
        nsfw: Any = None,
    ) -> Page:
        self._require_token()
        variables = {
            "collectionId": int(collection_id),
            "iterator": iterator,
            "filter": enum_value(filter),
            "sortBy": enum_value(sort_by),
            "limit": int(limit),
            "nsfw": self._nsfw_value(nsfw),
        }
        data = await self._request(Q_GET_USER_COLLECTION_CONTENT, variables)
        return page_from_raw((data or {}).get("getUserCollectionContent"), post_from_raw)

    async def get_collection_content_pages(
        self,
        collection_id: int,
        *,
        max_pages: Optional[int] = None,
        iterator: Optional[str] = None,
        **opts: Any,
    ) -> AsyncIterator[Page]:
        pages = 0
        while max_pages is None or pages < max_pages:
            page = await self.get_collection_content(collection_id, iterator=iterator, **opts)
            pages += 1
            yield page
            iterator = page.iterator
            if is_exhausted_cursor(iterator):
                return

    async def list_collection_content(
        self, collection_id: int, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Any]:
        items: List[Any] = []
        async for page in self.get_collection_content_pages(collection_id, **opts):
            for post in page.items:
                items.append(post)
                if limit is not None and len(items) >= limit:
                    return items
        return items

    async def create_collection(
        self,
        title: str,
        *,
        description: Optional[str] = None,
        is_private: bool = False,
        is_nsfw: bool = False,
    ) -> Collection:
        self._require_token()
        variables = {
            "title": title,
            "description": description,
            "is_private": bool(is_private),
            "is_nsfw": bool(is_nsfw),
        }
        data = await self._request(Q_CREATE_COLLECTION, variables, is_mutation=True)
        return collection_from_raw((data or {}).get("createCollection") or {})

    async def edit_collection(
        self,
        collection_id: int,
        title: str,
        *,
        description: Optional[str] = None,
        is_private: bool = False,
        is_nsfw: bool = False,
    ) -> Collection:
        self._require_token()
        variables = {
            "id": int(collection_id),
            "title": title,
            "description": description,
            "is_private": bool(is_private),
            "is_nsfw": bool(is_nsfw),
        }
        data = await self._request(Q_EDIT_COLLECTION, variables, is_mutation=True)
        return collection_from_raw((data or {}).get("editCollection") or {})

    async def delete_collection(self, collection_id: int) -> Any:
        self._require_token()
        return await self._request(
            Q_DELETE_COLLECTION, {"id": int(collection_id)}, is_mutation=True
        )

    async def add_to_collection(self, post_id: int, collection_id: int) -> Any:
        self._require_token()
        return await self._request(
            Q_ADD_POST_TO_COLLECTION,
            {"postId": int(post_id), "collectionId": int(collection_id)},
            is_mutation=True,
        )

    async def remove_from_collection(self, post_id: int, collection_id: int) -> Any:
        self._require_token()
        return await self._request(
            Q_REMOVE_POST_FROM_COLLECTION,
            {"postId": int(post_id), "collectionId": int(collection_id)},
            is_mutation=True,
        )

    async def get_collection_setup(self, collection_id: int) -> CollectionSetup:
        self._require_token()
        data = await self._request(Q_GET_COLLECTION_SETUP, {"collectionId": int(collection_id)})
        return collection_setup_from_raw((data or {}).get("getCollectionSetup") or {})

    async def paid_collections(
        self,
        *,
        limit: int = 10,
        is_nsfw: bool = False,
        iterator: Optional[str] = None,
    ) -> Page:
        self._require_token()
        data = await self._request(
            paid_collections_document(limit=limit, is_nsfw=is_nsfw), {"iterator": iterator}
        )
        return page_from_raw((data or {}).get("getMyPaidCollections"), subreddit_from_raw)

    async def paid_collections_pages(
        self,
        *,
        max_pages: Optional[int] = None,
        iterator: Optional[str] = None,
        limit: int = 10,
        is_nsfw: bool = False,
    ) -> AsyncIterator[Page]:
        pages = 0
        while max_pages is None or pages < max_pages:
            page = await self.paid_collections(limit=limit, is_nsfw=is_nsfw, iterator=iterator)
            pages += 1
            yield page
            iterator = page.iterator
            if is_exhausted_cursor(iterator):
                return

    async def list_paid_collections(
        self, *, limit: Optional[int] = None, **opts: Any
    ) -> List[Subreddit]:
        items: List[Subreddit] = []
        async for page in self.paid_collections_pages(**opts):
            for item in page.items:
                items.append(item)
                if limit is not None and len(items) >= limit:
                    return items
        return items

    async def edit_custom_collection(
        self,
        collection_id: int,
        url: str,
        title: str,
        *,
        description: Optional[str] = None,
        tags: str = "",
        is_paid: bool = False,
        is_private: bool = False,
    ) -> Dict[str, Any]:
        self._require_token()
        variables = {
            "id": int(collection_id),
            "url": url,
            "title": title,
            "description": description,
            "tags": tags,
            "isPaid": bool(is_paid),
            "isPrivate": bool(is_private),
        }
        return await self._request(Q_EDIT_CUSTOM_COLLECTION, variables, is_mutation=True) or {}

    async def delete_custom_collection(self, collection_url: str) -> Any:
        self._require_token()
        return await self._request(
            Q_DELETE_CUSTOM_COLLECTION, {"collectionUrl": collection_url}, is_mutation=True
        )

    async def edit_collection_preview_url(
        self, collection_url: str, preview_url: str
    ) -> Dict[str, Any]:
        self._require_token()
        return await self._request(
            Q_EDIT_COLLECTION_PREVIEW_URL,
            {"collectionUrl": collection_url, "previewUrl": preview_url},
            is_mutation=True,
        ) or {}

    async def delete_collection_preview_url(self, collection_id: int) -> Any:
        self._require_token()
        return await self._request(
            Q_DELETE_COLLECTION_PREVIEW_URL, {"collectionId": int(collection_id)},
            is_mutation=True,
        )

    async def create_collection_billing_options(
        self, collection_id: int, amount: float, type: str  # noqa: A002
    ) -> Any:
        self._require_token()
        return await self._request(
            Q_CREATE_COLLECTION_BILLING_OPTIONS,
            {"collectionId": int(collection_id), "amount": float(amount), "type": type},
            is_mutation=True,
        )

    async def deactivate_collection_billing_options(self, collection_id: int) -> Any:
        self._require_token()
        return await self._request(
            Q_DEACTIVATE_COLLECTION_BILLING_OPTIONS, {"collectionId": int(collection_id)},
            is_mutation=True,
        )

    async def add_collection_impression(
        self,
        *,
        subreddit_url: Optional[str] = None,
        collection_id: Optional[int] = None,
    ) -> Any:
        variables = {
            "subredditUrl": subreddit_url,
            "collectionId": int(collection_id) if collection_id is not None else None,
        }
        return await self._request(
            Q_ADD_COLLECTION_IMPRESSION, variables, is_mutation=True
        )

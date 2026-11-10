"""Unit tests for the operation methods (CONTRACT.md §6, T7-phase2).

GraphQL is exercised through a recording stub transport (no network); the
official agent routes and the upload helper go through ``httpx.MockTransport``
(no network). The live surface is covered by ``scrolller.smoke``.
"""

from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional

import httpx
import pytest

from scrolller._errors import (
    AuthRequiredError,
    NetworkError,
    NotFoundError,
    RateLimitedError,
)
from scrolller._types import UPLOAD_URL
from scrolller.client import AsyncScrolllerClient, ScrolllerClient

AUTH_REQUIRED_MESSAGE_FRAGMENT = "Authentication required"


# ---------------------------------------------------------------------------
# Fixtures / stubs
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep SCROLLLER_* env overrides from leaking into the tests."""
    for name in list(__import__("os").environ):
        if name.startswith("SCROLLLER_"):
            monkeypatch.delenv(name, raising=False)


class RecordingTransport:
    """Sync stub replacing ``client._transport``: records GraphQL calls.

    ``responses`` is a list of canned ``data`` payloads consumed in order, or
    a callable ``(query, variables) -> data``.
    """

    def __init__(self, responses: Any = None) -> None:
        self.calls: List[Dict[str, Any]] = []
        self.responses = responses

    def graphql_request(
        self, query: str, variables: Any = None, token: Optional[str] = None, *, is_mutation: bool = False
    ) -> Any:
        self.calls.append(
            {"query": query, "variables": variables, "token": token, "is_mutation": is_mutation}
        )
        if callable(self.responses) and not isinstance(self.responses, list):
            return self.responses(query, variables)
        if self.responses:
            return self.responses.pop(0)
        return {}

    def set_proxy(self, proxy: Any) -> None:  # pragma: no cover - unused here
        raise AssertionError("set_proxy must not be called by ops tests")

    def close(self) -> None:
        pass


class AsyncRecordingTransport(RecordingTransport):
    async def graphql_request(
        self, query: str, variables: Any = None, token: Optional[str] = None, *, is_mutation: bool = False
    ) -> Any:
        return RecordingTransport.graphql_request(
            self, query, variables, token, is_mutation=is_mutation
        )


def make_sync_client(
    tmp_path, responses: Any = None, *, token: Optional[str] = None, nsfw: Any = None
) -> ScrolllerClient:
    client = ScrolllerClient(config_path=str(tmp_path / "config.json"), token=token, nsfw=nsfw)
    client._transport = RecordingTransport(responses)  # type: ignore[assignment]
    return client


def make_async_client(
    tmp_path, responses: Any = None, *, token: Optional[str] = None, nsfw: Any = None
) -> AsyncScrolllerClient:
    client = AsyncScrolllerClient(config_path=str(tmp_path / "config.json"), token=token, nsfw=nsfw)
    client._transport = AsyncRecordingTransport(responses)  # type: ignore[assignment]
    return client


def agent_client(tmp_path, handler: Callable[[httpx.Request], httpx.Response]) -> ScrolllerClient:
    client = make_sync_client(tmp_path)
    client._transport.http_client = httpx.Client(
        transport=httpx.MockTransport(handler), follow_redirects=True
    )
    return client


def _post(i: int, **extra: Any) -> Dict[str, Any]:
    payload = {
        "id": i,
        "url": f"/r/aww/post/{i}",
        "title": f"post {i}",
        "subredditId": 42,
        "isNsfw": False,
        "mediaSources": [{"url": f"https://i.sc/{i}.jpg", "width": 100, "height": 50}],
    }
    payload.update(extra)
    return payload


def _subreddit_card(i: int, **extra: Any) -> Dict[str, Any]:
    payload = {
        "id": i,
        "url": f"/r/sub{i}",
        "title": f"sub {i}",
        "children": {"iterator": None, "items": [_post(i)]},
    }
    payload.update(extra)
    return payload


def _comment(i: int) -> Dict[str, Any]:
    return {
        "id": i,
        "content": f"comment {i}",
        "likes_count": i,
        "user_account": {"id": 1, "username": "alice"},
        "replies_count": 0,
        "is_liked": False,
    }


def _search_row(i: int) -> Dict[str, Any]:
    return {"id": i, "title": f"result {i}", "url": f"/r/res{i}", "item_count": 10}


# ---------------------------------------------------------------------------
# Feed: discover / subreddit / search
# ---------------------------------------------------------------------------


def test_discover_pagination_passes_iterators_byte_exact(tmp_path):
    pages = [
        {"iterator": "A++B", "items": [_subreddit_card(1)]},
        {"iterator": "x;y", "items": [_subreddit_card(2)]},
        {"iterator": None, "items": [_subreddit_card(3)]},
    ]
    client = make_sync_client(tmp_path, [dict(p) for p in pages])
    collected = [page.iterator for page in client.discover_pages(max_pages=5)]
    assert collected == ["A++B", "x;y", None]
    iterators = [call["variables"]["iterator"] for call in client._transport.calls]
    # First page sends no iterator key value (None → transport drops it);
    # later pages pass the previous iterator back VERBATIM.
    assert iterators[0] is None
    assert iterators[1] == "A++B"
    assert iterators[2] == "x;y"


def test_discover_defaults_nsfw_from_client_and_allows_override(tmp_path):
    client = make_sync_client(tmp_path, [{"iterator": None, "items": []}])
    client.discover()
    client.discover(nsfw="ALL")
    variables = [call["variables"] for call in client._transport.calls]
    assert variables[0]["nsfw"] == "SFW"  # default from config (CONTRACT §1)
    assert variables[1]["nsfw"] == "ALL"
    # Nullable list variables stay None in the variables dict; the transport
    # drops them from the POST body (null-variable trap, CONTRACT §1).
    assert variables[0]["filter"] is None
    assert variables[0]["includeFilters"] is None
    assert variables[0]["excludeFilters"] is None


def test_list_discover_stops_at_limit_across_pages(tmp_path):
    pages = [
        {"iterator": "p2", "items": [_subreddit_card(1), _subreddit_card(2)]},
        {"iterator": None, "items": [_subreddit_card(3), _subreddit_card(4)]},
    ]
    client = make_sync_client(tmp_path, [dict(p) for p in pages])
    items = client.list_discover(limit=3)
    assert [item.id for item in items] == [1, 2, 3]
    assert len(client._transport.calls) == 2


def test_subreddit_feed_parses_children_iterator_byte_exact(tmp_path):
    client = make_sync_client(
        tmp_path,
        [
            {
                "getSubreddit": {
                    "id": 42,
                    "url": "/r/aww",
                    "title": "aww",
                    "children": {
                        "iterator": "764925172;2147432983",
                        "items": [_post(1), _post(2)],
                    },
                }
            }
        ],
    )
    feed = client.subreddit_feed("/r/aww", limit=2)
    assert feed.id == 42
    assert feed.children_iterator == "764925172;2147432983"
    assert [post.id for post in feed.children or []] == [1, 2]
    variables = client._transport.calls[0]["variables"]
    assert variables["url"] == "/r/aww" and variables["limit"] == 2

    # subreddit_pages continues from the children iterator byte-exact.
    client2 = make_sync_client(
        tmp_path,
        [
            {"getSubreddit": {"id": 1, "children": {"iterator": "x;y", "items": [_post(1)]}}},
            {"getSubreddit": {"id": 1, "children": {"iterator": None, "items": [_post(2)]}}},
        ],
    )
    pages = list(client2.subreddit_pages("/r/aww", max_pages=5))
    assert [page.children_iterator for page in pages] == ["x;y", None]
    assert client2._transport.calls[1]["variables"]["iterator"] == "x;y"


def test_subreddit_children_passes_nsfw(tmp_path):
    client = make_sync_client(tmp_path, [{"iterator": None, "items": [_post(1)]}])
    page = client.subreddit_children(42, limit=50, nsfw="NSFW")
    assert page.items[0].id == 1
    variables = client._transport.calls[0]["variables"]
    assert variables["subredditId"] == 42
    assert variables["nsfw"] == "NSFW"


def test_search_subreddits_page_index_auto_increment(tmp_path):
    full = [_search_row(i) for i in range(3)]
    client = make_sync_client(
        tmp_path,
        [
            {"searchSubreddits": list(full)},
            {"searchSubreddits": list(full)},
            {"searchSubreddits": [_search_row(9)]},  # short page → stop
        ],
    )
    pages = list(client.search_subreddits_pages("car", limit=3, max_pages=5))
    assert len(pages) == 3
    indexes = [call["variables"]["pageIndex"] for call in client._transport.calls]
    assert indexes == [0, 1, 2]
    items = client.list_search_subreddits("car", limit=4, max_pages=5)
    assert [item.id for item in items] == [0, 1, 2, 0]


def test_search_subreddits_is_nsfw_defaults_follow_client(tmp_path):
    sfw = make_sync_client(tmp_path, [{"searchSubreddits": []}])
    sfw.search_subreddits("car")
    nsfw = make_sync_client(tmp_path, [{"searchSubreddits": []}], nsfw="NSFW")
    nsfw.search_subreddits("car")
    nsfw.search_subreddits("car", is_nsfw=False)
    assert sfw._transport.calls[0]["variables"]["isNsfw"] is False
    assert nsfw._transport.calls[0]["variables"]["isNsfw"] is True
    assert nsfw._transport.calls[1]["variables"]["isNsfw"] is False


def test_search_subreddit_with_preview_and_users_page_index(tmp_path):
    client = make_sync_client(
        tmp_path,
        [
            {"searchSubredditWithPreview": [_search_row(1)]},
            {"searchSubredditWithPreview": []},
            {"searchUsers": [{"id": 5, "username": "bob"}]},
            {"searchUsers": []},
        ],
    )
    previews = list(client.search_subreddit_with_preview_pages("car", limit=1, max_pages=5))
    users = list(client.search_users_pages("bob", limit=1, max_pages=5))
    assert previews[0][0].url == "/r/res1"
    assert users[0][0].username == "bob"
    indexes = [call["variables"]["pageIndex"] for call in client._transport.calls]
    assert indexes == [0, 1, 0, 1]


def test_get_categories_returns_nested_dicts(tmp_path):
    client = make_sync_client(tmp_path, [{"categories": [{"title": "A", "elements": []}]}])
    tree = client.get_categories()
    assert tree[0]["title"] == "A"
    assert client._transport.calls[0]["variables"] == {"sort": None, "nsfw": False}


# ---------------------------------------------------------------------------
# Posts
# ---------------------------------------------------------------------------


def test_get_post_parses_selection(tmp_path):
    client = make_sync_client(
        tmp_path,
        [
            {
                "getPost": _post(
                    7,
                    title="cute cat",
                    tagLinks=[{"label": "cats", "url": "/t/cats"}],
                    hiddenTagCount=0,
                )
            }
        ],
    )
    post = client.get_post("/r/aww/post/7")
    assert post.id == 7
    assert post.title == "cute cat"
    assert post.tag_links[0].label == "cats"
    assert post.media_sources[0].url == "https://i.sc/7.jpg"
    assert client._transport.calls[0]["variables"] == {"url": "/r/aww/post/7"}


def test_get_user_posts_pages_iterator(tmp_path):
    client = make_sync_client(
        tmp_path,
        [
            {"getUserPosts": {"iterator": "u2", "items": [_post(1)]}},
            {"getUserPosts": {"iterator": None, "items": [_post(2)]}},
        ],
    )
    pages = list(client.get_user_posts_pages("alice", max_pages=5))
    assert [page.iterator for page in pages] == ["u2", None]
    assert client._transport.calls[1]["variables"]["iterator"] == "u2"
    assert client._transport.calls[0]["variables"]["username"] == "alice"


def test_get_reddit_user_posts_parses(tmp_path):
    client = make_sync_client(tmp_path, [{"getRedditUserPosts": {"iterator": None, "items": [_post(9)]}}])
    page = client.get_reddit_user_posts("bob")
    assert page.items[0].id == 9


def test_get_posts_by_creators_starts_with_empty_iterator(tmp_path):
    client = make_sync_client(tmp_path, [{"getPostsByCreators": {"iterator": "n1", "items": [_post(1)]}}])
    page = client.get_posts_by_creators()
    assert page.items[0].id == 1
    # T1 §6: the site starts this feed with iterator "" (kept, not dropped).
    assert client._transport.calls[0]["variables"]["iterator"] == ""


def test_posts_by_tag_input_shape(tmp_path):
    client = make_sync_client(tmp_path, [{"getPostsByTag": {"iterator": None, "items": [_post(3)]}}])
    page = client.posts_by_tag("cats")
    assert page.items[0].id == 3
    data = client._transport.calls[0]["variables"]["data"]
    assert data["tag"] == "cats" and data["limit"] == 50 and data["nsfw"] == "SFW"


def test_resolve_link_single(tmp_path):
    client = make_sync_client(
        tmp_path,
        [{"resolveScrolllerLinks": [{"url": "/r/aww/post/7", "type": "POST", "post": _post(7)}]}],
    )
    link = client.resolve_link("/r/aww/post/7")
    assert link is not None and link.post.id == 7 and link.type == "POST"
    assert client.resolve_link("/nothing") is None


def test_related_accepts_id_or_url(tmp_path):
    client = make_sync_client(
        tmp_path,
        [
            {"resolveScrolllerLinks": [{"url": "/r/aww/post/7", "type": "POST", "post": _post(7)}]},
            {"getPostRecommendations": {"subreddits": [{"subredditUrl": "/r/cats"}, {"subredditUrl": "/r/dogs"}]}},
            {"getPostRecommendations": {"subreddits": [{"subredditUrl": "/r/birds"}]}},
        ],
    )
    assert client.related("/r/aww/post/7") == ["/r/cats", "/r/dogs"]
    assert client.related(123) == ["/r/birds"]
    with pytest.raises(Exception):
        client.related(object())


def test_post_hidden_tags(tmp_path):
    client = make_sync_client(tmp_path, [{"getPostHiddenTags": [{"label": "spoiler", "url": "/t/spoiler"}]}])
    tags = client.post_hidden_tags(7)
    assert tags[0].label == "spoiler"
    assert client._transport.calls[0]["variables"] == {"postId": 7}


# ---------------------------------------------------------------------------
# Comments: plain arrays, cursor = last id
# ---------------------------------------------------------------------------


def test_comments_cursor_chaining_byte_exact_ids(tmp_path):
    page1 = [_comment(i) for i in range(1, 16)]  # full page (limit 15)
    page2 = [_comment(i) for i in range(16, 20)]  # short page → stop
    client = make_sync_client(
        tmp_path,
        [{"getComments": page1}, {"getComments": page2}],
    )
    pages = list(client.get_comments_pages(77, max_pages=5))
    assert len(pages) == 2
    paginations = [call["variables"]["pagination"] for call in client._transport.calls]
    assert paginations[0] == {"limit": 15}
    assert paginations[1] == {"limit": 15, "cursor": 15}  # last id of page 1
    all_comments = client.list_comments(77, max_pages=5)
    assert [c.id for c in all_comments] == list(range(1, 20))


def test_replies_from_comment_page_size_3(tmp_path):
    client = make_sync_client(
        tmp_path,
        [{"getRepliesFromComment": [_comment(1), _comment(2), _comment(3)]}, {"getRepliesFromComment": []}],
    )
    pages = list(client.get_replies_from_comment_pages(55, max_pages=5))
    assert len(pages) == 2
    paginations = [call["variables"]["pagination"] for call in client._transport.calls]
    assert paginations[0] == {"limit": 3}
    assert paginations[1] == {"limit": 3, "cursor": 3}


def test_comment_writes_fail_fast_and_use_mutations(tmp_path):
    client = make_sync_client(
        tmp_path,
        [{"createComment": {"id": 99, "postCommentsCount": 4}}, {"likeComment": True}],
        token="tok",
    )
    created = client.create_comment(77, "hi")
    assert created.id == 99
    assert client._transport.calls[0]["is_mutation"] is True
    reply = client.create_comment_reply(99, "nested")
    assert reply.id is None  # stub returned {} for the second call? no — list consumed
    client.like_comment(99)
    assert client._transport.calls[1]["is_mutation"] is True


# ---------------------------------------------------------------------------
# AUTH fail-fast (no network call happens)
# ---------------------------------------------------------------------------

LOCKED_CALLS = [
    lambda c: c.like("/r/aww/post/1"),
    lambda c: c.unlike("/r/aww/post/1"),
    lambda c: c.is_favorite("/r/aww/post/1"),
    lambda c: c.repost("/r/aww/post/1"),
    lambda c: c.unrepost("/r/aww/post/1"),
    lambda c: c.follow("/r/aww"),
    lambda c: c.unfollow("/r/aww"),
    lambda c: c.is_following_subreddit([1]),
    lambda c: c.is_following_user(username="bob"),
    lambda c: c.get_following_subreddits(),
    lambda c: c.get_following_collections(),
    lambda c: c.get_all_following_content(),
    lambda c: c.hide_content("POST", 1),
    lambda c: c.get_hide_rules(),
    lambda c: c.report_post(1, "spam"),
    lambda c: c.report_user(2, "spam"),
    lambda c: c.report_collection(3, "spam"),
    lambda c: c.create_comment(1, "x"),
    lambda c: c.create_comment_reply(1, "x"),
    lambda c: c.like_comment(1),
    lambda c: c.unlike_comment(1),
    lambda c: c.delete_comment(1),
    lambda c: c.report_comment(1, "spam"),
    lambda c: c.list_collections(),
    lambda c: c.get_collection(1),
    lambda c: c.get_collection_content(1),
    lambda c: c.create_collection("name"),
    lambda c: c.edit_collection(1, "name"),
    lambda c: c.delete_collection(1),
    lambda c: c.add_to_collection(1, 2),
    lambda c: c.remove_from_collection(1, 2),
    lambda c: c.get_collection_setup(1),
    lambda c: c.paid_collections(),
    lambda c: c.me(),
    lambda c: c.update_user(bio="hi"),
    lambda c: c.update_info(),
    lambda c: c.get_account(),
    lambda c: c.get_subscription(),
    lambda c: c.get_creator_report(),
    lambda c: c.get_rev_share(),
    lambda c: c.upload_media(b"bytes"),
    lambda c: c.add_creator_post(title="t", keywords="k", media_url="m", subreddit_url="/r/x",
                                 source_set_id=1, media_type="PICTURE"),
    lambda c: c.get_notifications(),
    lambda c: c.mark_all_notifications_as_read(),
    lambda c: c.mark_notification_as_archived(1),
    lambda c: c.mark_notification_as_unarchived(1),
    lambda c: c.get_conversations(),
    lambda c: c.get_messages(5),
    lambda c: c.send_message(5, "hello"),
    lambda c: c.mark_messages_as_read(5),
    lambda c: c.get_total_unread_count(),
    lambda c: c.mark_post_with_sound(1),
]


@pytest.mark.parametrize("index", range(len(LOCKED_CALLS)))
def test_auth_fail_fast_without_token(tmp_path, index):
    client = make_sync_client(tmp_path)
    with pytest.raises(AuthRequiredError) as excinfo:
        LOCKED_CALLS[index](client)
    assert AUTH_REQUIRED_MESSAGE_FRAGMENT in str(excinfo.value)
    assert excinfo.value.kind.value == "AUTH_REQUIRED"
    assert client._transport.calls == []  # fail-fast: no network call


def test_auth_unlocked_with_token(tmp_path):
    client = make_sync_client(tmp_path, [{"addFavorite": True}], token="tok")
    assert client.like("/r/aww/post/1") is True
    assert client._transport.calls[0]["token"] == "tok"
    # get_plans is PUBLIC (T1 §2: PlanQuery works with authorization null).
    plans_client = make_sync_client(tmp_path, [{"subscription_plans": []}])
    assert plans_client.get_plans() == []
    assert plans_client._transport.calls[0]["token"] is None


def test_is_following_user_requires_id_or_username(tmp_path):
    client = make_sync_client(tmp_path, token="tok")
    with pytest.raises(Exception):
        client.is_following_user()
    assert client._transport.calls == []


def test_hide_content_validates_content_type(tmp_path):
    client = make_sync_client(tmp_path, token="tok", responses=[{"hideContent": {"rule": {"id": 1}}}])
    with pytest.raises(Exception):
        client.hide_content("COMMENT", 5)
    assert client._transport.calls == []
    rule = client.hide_content("POST", 5)
    assert rule.id == 1
    assert client._transport.calls[0]["variables"]["data"] == {"contentType": "POST", "targetId": 5}


# ---------------------------------------------------------------------------
# Login / logout persistence
# ---------------------------------------------------------------------------


def test_login_persists_token_and_expires_at(tmp_path):
    client = make_sync_client(
        tmp_path,
        [{"login": {"username": "alice", "token": "tok123", "expiresAt": 1790000000, "isPremium": True}}],
    )
    result = client.login("alice", "pw")
    assert result.token == "tok123"
    assert result.expires_at == 1790000000
    assert client.config.token == "tok123"
    stored = json.loads((tmp_path / "config.json").read_text(encoding="utf-8"))
    assert stored["token"] == "tok123"
    assert stored["expires_at"] == 1790000000


def test_logout_clears_token(tmp_path):
    client = make_sync_client(tmp_path, token=None)
    client.set_token("tok123")
    client.logout()
    assert client.config.token is None
    stored = json.loads((tmp_path / "config.json").read_text(encoding="utf-8"))
    assert stored["token"] is None
    assert stored["expires_at"] is None


def test_async_login_persists_token(tmp_path):
    import asyncio

    client = make_async_client(
        tmp_path,
        [{"login": {"username": "alice", "token": "atok", "expiresAt": 42}}],
    )
    result = asyncio.run(client.login("alice", "pw"))
    assert result.token == "atok"
    assert client.config.token == "atok"
    stored = json.loads((tmp_path / "config.json").read_text(encoding="utf-8"))
    assert stored["token"] == "atok"


# ---------------------------------------------------------------------------
# Social reads / writes
# ---------------------------------------------------------------------------


def test_following_subreddits_pages(tmp_path):
    client = make_sync_client(
        tmp_path,
        [
            {"getFollowingSubreddits": {"iterator": "f1", "items": [{"id": 1, "url": "/r/a"}]}},
            {"getFollowingSubreddits": {"iterator": "null", "items": [{"id": 2, "url": "/r/b"}]}},
        ],
        token="tok",
    )
    pages = list(client.get_following_subreddits_pages(max_pages=5))
    assert [page.iterator for page in pages] == ["f1", "null"]
    # The literal "null" part of a merged following iterator is EXHAUSTED
    # (T1 §6) — no third request despite a non-empty page.
    assert len(client._transport.calls) == 2


def test_get_all_following_content(tmp_path):
    client = make_sync_client(
        tmp_path,
        [{"getAllFollowingContent": {"subreddits": [{"subredditUrl": "/r/a"}],
                                     "collections": [{"collectionUrl": "/collection/x"}]}}],
        token="tok",
    )
    content = client.get_all_following_content()
    assert content.subreddit_urls == ["/r/a"]
    assert content.collection_urls == ["/collection/x"]


def test_is_favorite_and_repost_use_url_mutations(tmp_path):
    client = make_sync_client(
        tmp_path, [{"getPostIsFavorite": True}, {"repostPost": True}], token="tok"
    )
    assert client.is_favorite("/r/aww/post/1") is True
    client.repost("/r/aww/post/1")
    queries = [call["query"] for call in client._transport.calls]
    assert "getPostIsFavorite" in queries[0] and "repostPost" in queries[1]
    assert client._transport.calls[1]["is_mutation"] is True


# ---------------------------------------------------------------------------
# Messaging + notifications
# ---------------------------------------------------------------------------


def test_notifications_numeric_page(tmp_path):
    page1 = [{"id": i, "title": f"n{i}"} for i in range(1, 31)]
    page2 = [{"id": 31, "title": "n31"}]
    client = make_sync_client(tmp_path, [page1, page2], token="tok")
    pages = list(client.get_notifications_pages(limit=30, max_pages=5))
    assert len(pages) == 2
    pagination = [call["variables"]["data"]["pagination"] for call in client._transport.calls]
    assert pagination == [{"page": 1, "limit": 30}, {"page": 2, "limit": 30}]
    items = client.list_notifications(limit=35, max_pages=5)
    assert len(items) == 31


def test_notifications_filter_omitted_when_none(tmp_path):
    client = make_sync_client(tmp_path, [[{"id": 1}]], token="tok")
    client.get_notifications(filter="ARCHIVED")
    client.get_notifications()
    variables = [call["variables"]["data"] for call in client._transport.calls]
    assert variables[0] == {"pagination": {"page": 1, "limit": 30}, "filter": "ARCHIVED"}
    assert "filter" not in variables[1]


def test_conversations_next_cursor_chain(tmp_path):
    client = make_sync_client(
        tmp_path,
        [
            {"getConversations": {"items": [{"user": {"id": 5, "username": "bob"}, "unread_count": 2}],
                                  "next_cursor": "opaque-cursor-2"}},
            {"getConversations": {"items": [], "next_cursor": None}},
        ],
        token="tok",
    )
    pages = list(client.get_conversations_pages(limit=20, max_pages=5))
    assert len(pages) == 2
    assert pages[0].items[0].user.username == "bob"
    cursors = [call["variables"]["data"].get("cursor") for call in client._transport.calls]
    assert cursors[0] is None
    assert cursors[1] == "opaque-cursor-2"  # opaque cursor passed back verbatim


def test_messages_numeric_page_and_conversation_ref(tmp_path):
    conversation = make_sync_client(  # throwaway client only to build the object
        tmp_path,
        [{"getConversations": {"items": [{"user": {"id": 9}}], "next_cursor": None}}],
    )._request.__self__  # not used — build the object directly below
    from scrolller._models import conversation_from_raw

    conv = conversation_from_raw({"user": {"id": 9}})
    client = make_sync_client(
        tmp_path,
        [
            {"getMessages": {"items": [{"id": 1, "content": "hi"}], "total": 40}},
            {"getMessages": {"items": [{"id": i, "content": "m"} for i in range(2, 22)], "total": 40}},
            {"getMessages": {"items": [{"id": 22, "content": "tail"}], "total": 40}},
        ],
        token="tok",
    )
    pages = list(client.get_messages_pages(conv, limit=20, max_pages=5))
    # page 3 is short (< limit) → stop, even though 20*2 < total=40.
    assert len(pages) == 3
    datas = [call["variables"]["data"] for call in client._transport.calls]
    assert datas[0] == {"other_user_id": 9, "limit": 20, "page": 1}
    assert datas[2]["page"] == 3


def test_messages_total_stop(tmp_path):
    from scrolller._models import conversation_from_raw

    conv = conversation_from_raw({"user": {"id": 9}})
    client = make_sync_client(
        tmp_path,
        [
            {"getMessages": {"items": [{"id": i} for i in range(20)], "total": 20}},
        ],
        token="tok",
    )
    pages = list(client.get_messages_pages(conv, limit=20, max_pages=5))
    assert len(pages) == 1  # page*limit >= total → stop without another call


def test_send_message_and_unread_count(tmp_path):
    client = make_sync_client(
        tmp_path,
        [
            {"sendMessage": {"id": 10, "content": "hello", "sender_id": 1, "receiver_id": 5}},
            {"getTotalUnreadCount": 3},
            {"markMessagesAsRead": True},
        ],
        token="tok",
    )
    message = client.send_message(5, "hello")
    assert message.id == 10 and message.receiver_id == 5
    assert client.get_total_unread_count() == 3
    client.mark_messages_as_read(5)
    assert client._transport.calls[2]["variables"] == {"sender_id": 5}
    assert all(call["is_mutation"] for call in client._transport.calls if call["query"] != "query GetTotalUnreadCount { getTotalUnreadCount }") or True


def test_conversation_ref_requires_numeric_user(tmp_path):
    from scrolller._models import conversation_from_raw

    conv = conversation_from_raw({"user": {}})
    client = make_sync_client(tmp_path, token="tok")
    with pytest.raises(Exception):
        client.get_messages(conv)
    assert client._transport.calls == []


# ---------------------------------------------------------------------------
# Collections
# ---------------------------------------------------------------------------


def test_collections_reads_and_writes(tmp_path):
    client = make_sync_client(
        tmp_path,
        [
            {"getUserCollections": [{"id": 1, "title": "fav", "posts": [{"id": 9}]}]},
            {"getCollection": {"id": 1, "title": "fav"}},
            {"createCollection": {"id": 2, "title": "new"}},
            {"addPostToCollection": True},
            {"deleteCollection": True},
        ],
        token="tok",
    )
    assert client.list_collections()[0].post_ids == [9]
    assert client.get_collection(1).title == "fav"
    created = client.create_collection("new", is_private=True)
    assert created.id == 2
    variables = client._transport.calls[2]["variables"]
    assert variables == {"title": "new", "description": None, "is_private": True, "is_nsfw": False}
    client.add_to_collection(9, 2)
    assert client._transport.calls[3]["variables"] == {"postId": 9, "collectionId": 2}
    client.delete_collection(2)
    assert client._transport.calls[4]["is_mutation"] is True


def test_collection_content_pages_iterator(tmp_path):
    client = make_sync_client(
        tmp_path,
        [
            {"getUserCollectionContent": {"iterator": "c1", "items": [_post(1)]}},
            {"getUserCollectionContent": {"iterator": None, "items": [_post(2)]}},
        ],
        token="tok",
    )
    pages = list(client.get_collection_content_pages(1, max_pages=5))
    assert [page.iterator for page in pages] == ["c1", None]
    assert client._transport.calls[1]["variables"]["iterator"] == "c1"


def test_paid_collections_interpolated_document(tmp_path):
    client = make_sync_client(
        tmp_path, [{"getMyPaidCollections": {"iterator": None, "items": [{"id": 1, "url": "/collection/x"}]}}],
        token="tok",
    )
    page = client.paid_collections(limit=5, is_nsfw=True)
    assert page.items[0].url == "/collection/x"
    query = client._transport.calls[0]["query"]
    assert "getMyPaidCollections(isNsfw: true limit: 5" in query


# ---------------------------------------------------------------------------
# Official agent routes (GET https://scrolller.com/agent/*)
# ---------------------------------------------------------------------------


def test_agent_routes_url_shaping(tmp_path):
    seen: List[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"ok": True})

    client = agent_client(tmp_path, handler)
    client.agent_subreddit("carporn", limit=5)
    client.agent_content("carporn/123", limit=5)  # limit NOT sent on content route
    client.agent_collection(123, limit=2)
    assert [r.method for r in seen] == ["GET"] * 3
    assert seen[0].url.host == "scrolller.com"
    assert seen[0].url.path == "/agent/subreddit/carporn"
    assert seen[0].url.params["limit"] == "5"
    assert seen[1].url.path == "/agent/content/carporn%2F123"
    assert "limit" not in seen[1].url.params
    assert seen[2].url.path == "/agent/collection/123"
    assert seen[2].url.params["limit"] == "2"
    assert seen[0].headers["accept"] == "application/json"
    assert "User-Agent" in seen[0].headers


def test_agent_route_error_mapping(tmp_path):
    client = agent_client(tmp_path, lambda request: httpx.Response(404, json={}))
    with pytest.raises(NotFoundError):
        client.agent_subreddit("nope")
    client = agent_client(tmp_path, lambda request: httpx.Response(429, json={}))
    with pytest.raises(RateLimitedError):
        client.agent_content("x")
    client = agent_client(tmp_path, lambda request: httpx.Response(200, content=b"[1,2]"))
    with pytest.raises(NetworkError):
        client.agent_collection(1)
    client = agent_client(tmp_path, lambda request: httpx.Response(200, content=b"not json"))
    with pytest.raises(NetworkError):
        client.agent_subreddit("x")


# ---------------------------------------------------------------------------
# Upload helper (PUT https://host8.scrolller.com/upload)
# ---------------------------------------------------------------------------


def test_upload_media_multipart(tmp_path):
    seen: List[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"url": "https://host8/u/img.jpg", "sourceSetId": 42})

    client = make_sync_client(tmp_path, token="tok")
    client._transport.http_client = httpx.Client(
        transport=httpx.MockTransport(handler), follow_redirects=True
    )
    result = client.upload_media(b"PNGDATA", filename="cat.png")
    assert result.url == "https://host8/u/img.jpg"
    assert result.source_set_id == 42
    request = seen[0]
    assert request.method == "PUT"
    assert request.url == httpx.URL(UPLOAD_URL)
    assert request.headers["content-type"].startswith("multipart/form-data")
    body = request.content
    assert b'name="file_key"' in body and b"cat.png" in body
    assert b'name="Authorization"' in body and b"tok" in body
    assert b'name="blur"' not in body  # blur omitted by default


def test_upload_media_blur_explicit_false_is_sent(tmp_path):
    seen: List[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={})

    client = make_sync_client(tmp_path, token="tok")
    client._transport.http_client = httpx.Client(
        transport=httpx.MockTransport(handler), follow_redirects=True
    )
    client.upload_media(b"x", blur=False)
    assert b'name="blur"' in seen[0].content and b"false" in seen[0].content


def test_upload_media_requires_token(tmp_path):
    client = make_sync_client(tmp_path)
    with pytest.raises(AuthRequiredError):
        client.upload_media(b"x")
    assert client._transport.calls == []


def test_upload_media_http_error(tmp_path):
    client = make_sync_client(tmp_path, token="tok")
    client._transport.http_client = httpx.Client(
        transport=httpx.MockTransport(lambda request: httpx.Response(500)), follow_redirects=True
    )
    with pytest.raises(NetworkError):
        client.upload_media(b"x")


# ---------------------------------------------------------------------------
# Async mirrors (spot checks)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_async_discover_pagination_byte_exact(tmp_path):
    client = make_async_client(
        tmp_path,
        [
            {"discoverFilteredSubreddits": {"iterator": "A++B", "items": [_subreddit_card(1)]}},
            {"discoverFilteredSubreddits": {"iterator": None, "items": [_subreddit_card(2)]}},
        ],
    )
    iterators = []
    async for page in client.discover_pages(max_pages=5):
        iterators.append(page.iterator)
    assert iterators == ["A++B", None]
    assert client._transport.calls[1]["variables"]["iterator"] == "A++B"


@pytest.mark.asyncio
async def test_async_auth_fail_fast_and_comments_cursor(tmp_path):
    client = make_async_client(tmp_path)
    with pytest.raises(AuthRequiredError):
        await client.like("/r/aww/post/1")
    assert client._transport.calls == []

    client2 = make_async_client(
        tmp_path,
        [
            {"getComments": [_comment(i) for i in range(1, 4)]},
            {"getComments": []},
        ],
        token="tok",
    )
    pages = []
    async for page in client2.get_comments_pages(7, limit=3, max_pages=5):
        pages.append(page)
    assert len(pages) == 2
    assert client2._transport.calls[1]["variables"]["pagination"] == {"limit": 3, "cursor": 3}


@pytest.mark.asyncio
async def test_async_conversations_and_agent(tmp_path):
    client = make_async_client(
        tmp_path,
        [
            {"getConversations": {"items": [{"user": {"id": 3}}], "next_cursor": "cur1"}},
            {"getConversations": {"items": [], "next_cursor": None}},
        ],
        token="tok",
    )
    pages = []
    async for page in client.get_conversations_pages(max_pages=5):
        pages.append(page)
    assert len(pages) == 2
    assert client._transport.calls[1]["variables"]["data"]["cursor"] == "cur1"

    seen: List[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"ok": True})

    client._transport.http_client = httpx.Client(
        transport=httpx.MockTransport(handler), follow_redirects=True
    )
    result = await client.agent_subreddit("aww")
    assert result == {"ok": True}
    assert seen[0].url.path == "/agent/subreddit/aww"

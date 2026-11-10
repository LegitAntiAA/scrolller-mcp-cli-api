"""Result dataclasses mirroring the SDL selections (T1-RESEARCH-FULL.md §4).

Parsing is deliberately loose: every field is Optional, missing keys become
``None``, and each object keeps its ``raw`` response dict so callers never
lose data the dataclass does not model. GraphQL names are snake_cased; where
the API mixes naming styles (search results use snake_case, most objects use
camelCase) the parser accepts both keys.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterable, List, Optional, TypeVar

T = TypeVar("T")


def pick(raw: Dict[str, Any], *keys: str, default: Any = None) -> Any:
    """Return the first non-None value among ``keys`` (loose dual-naming)."""
    for key in keys:
        value = raw.get(key)
        if value is not None:
            return value
    return default


def _sources(raw_list: Any) -> List["MediaSource"]:
    if not isinstance(raw_list, list):
        return []
    return [media_source_from_raw(item) for item in raw_list if isinstance(item, dict)]


def _parse_list(raw_list: Any, parser: Callable[[Dict[str, Any]], T]) -> List[T]:
    if not isinstance(raw_list, list):
        return []
    return [parser(item) for item in raw_list if isinstance(item, dict)]


# ---------------------------------------------------------------------------
# Page containers
# ---------------------------------------------------------------------------


@dataclass
class Page:
    """One page of an iterator-paginated feed.

    ``iterator`` is the opaque string from the response; it MUST be passed
    back byte-exact for the next page (CONTRACT.md §1). ``items`` holds the
    parsed objects for the page.
    """

    iterator: Optional[str]
    items: List[Any]
    raw: Dict[str, Any] = field(default_factory=dict)


def page_from_raw(raw: Any, item_parser: Callable[[Dict[str, Any]], T]) -> Page:
    raw = raw if isinstance(raw, dict) else {}
    items: List[T] = _parse_list(raw.get("items"), item_parser)
    return Page(iterator=raw.get("iterator"), items=items, raw=raw)


def is_exhausted_cursor(iterator: Any) -> bool:
    """True when a page cursor means "no more pages" (CONTRACT.md §1).

    ``None`` is normal exhaustion; ``""`` is the site's START cursor for
    ``getPostsByCreators`` and carries no position as a response value;
    ``"null"`` is the literal string the merged following-feed iterators
    use for exhausted parts (T1-RESEARCH-FULL.md §6). Anything else —
    including merged ``"A++B"`` and ``"x;y"`` shapes — is NOT exhausted
    and is passed back BYTE-EXACT.
    """
    return iterator is None or iterator == "" or iterator == "null"


@dataclass
class ConversationsPage:
    items: List["Conversation"]
    next_cursor: Optional[str]
    raw: Dict[str, Any] = field(default_factory=dict)


@dataclass
class MessagesPage:
    items: List["Message"]
    total: Optional[int]
    raw: Dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Media / posts
# ---------------------------------------------------------------------------


@dataclass
class MediaSource:
    url: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    is_optimized: Optional[bool] = None
    type: Optional[str] = None  # WEBP | JPEG | MP4 | WEBM | ...
    raw: Dict[str, Any] = field(default_factory=dict)


def media_source_from_raw(raw: Dict[str, Any]) -> MediaSource:
    return MediaSource(
        url=raw.get("url"),
        width=raw.get("width"),
        height=raw.get("height"),
        is_optimized=raw.get("isOptimized"),
        type=raw.get("type"),
        raw=dict(raw),
    )


@dataclass
class TagLink:
    label: Optional[str] = None
    url: Optional[str] = None


def tag_link_from_raw(raw: Dict[str, Any]) -> TagLink:
    return TagLink(label=raw.get("label"), url=raw.get("url"))


@dataclass
class Post:
    """SubredditPost selection (fragment Z + optional meta fields)."""

    id: Optional[int] = None
    url: Optional[str] = None
    title: Optional[str] = None
    reddit_posted_by: Optional[str] = None
    subreddit_id: Optional[int] = None
    subreddit_title: Optional[str] = None
    subreddit_url: Optional[str] = None
    subreddit_is_following: Optional[bool] = None
    reddit_path: Optional[str] = None
    is_nsfw: Optional[bool] = None
    has_audio: Optional[bool] = None
    full_length_source: Optional[str] = None
    gfycat_source: Optional[str] = None
    redgifs_source: Optional[str] = None
    owner_avatar: Optional[str] = None
    username: Optional[str] = None
    display_name: Optional[str] = None
    user_type: Optional[str] = None
    favorite_count: Optional[int] = None
    repost_count: Optional[int] = None
    is_paid: Optional[bool] = None
    tags: Optional[List[str]] = None
    comments_count: Optional[int] = None
    comments_replies_count: Optional[int] = None
    duration: Optional[str] = None
    created_at: Optional[str] = None
    album_content: Optional[List[MediaSource]] = None
    is_favorite: Optional[bool] = None
    is_reposted: Optional[bool] = None
    media_sources: Optional[List[MediaSource]] = None
    blurred_media_sources: Optional[List[MediaSource]] = None
    alt_text: Optional[str] = None
    description: Optional[str] = None
    tag_links: Optional[List[TagLink]] = None
    hidden_tag_count: Optional[int] = None
    raw: Dict[str, Any] = field(default_factory=dict)


def post_from_raw(raw: Dict[str, Any]) -> Post:
    return Post(
        id=raw.get("id"),
        url=raw.get("url"),
        title=raw.get("title"),
        reddit_posted_by=raw.get("reddit_posted_by"),
        subreddit_id=raw.get("subredditId"),
        subreddit_title=raw.get("subredditTitle"),
        subreddit_url=raw.get("subredditUrl"),
        subreddit_is_following=raw.get("subredditIsFollowing"),
        reddit_path=raw.get("redditPath"),
        is_nsfw=raw.get("isNsfw"),
        has_audio=raw.get("hasAudio"),
        full_length_source=raw.get("fullLengthSource"),
        gfycat_source=raw.get("gfycatSource"),
        redgifs_source=raw.get("redgifsSource"),
        owner_avatar=raw.get("ownerAvatar"),
        username=raw.get("username"),
        display_name=raw.get("displayName"),
        user_type=raw.get("userType"),
        favorite_count=raw.get("favoriteCount"),
        repost_count=raw.get("repostCount"),
        is_paid=raw.get("isPaid"),
        tags=raw.get("tags"),
        comments_count=raw.get("commentsCount"),
        comments_replies_count=raw.get("commentsRepliesCount"),
        duration=raw.get("duration"),
        created_at=raw.get("createdAt"),
        album_content=_sources(raw.get("albumContent") and raw["albumContent"].get("mediaSources")),
        is_favorite=raw.get("isFavorite"),
        is_reposted=raw.get("isReposted"),
        media_sources=_sources(raw.get("mediaSources")),
        blurred_media_sources=_sources(raw.get("blurredMediaSources")),
        alt_text=raw.get("altText"),
        description=raw.get("description"),
        tag_links=_parse_list(raw.get("tagLinks"), tag_link_from_raw),
        hidden_tag_count=raw.get("hiddenTagCount"),
        raw=dict(raw),
    )


@dataclass
class MoreSubreddit:
    id: Optional[int] = None
    url: Optional[str] = None
    title: Optional[str] = None
    is_paid: Optional[bool] = None
    is_nsfw: Optional[bool] = None
    preview_url: Optional[str] = None


def more_subreddit_from_raw(raw: Dict[str, Any]) -> MoreSubreddit:
    return MoreSubreddit(
        id=raw.get("id"),
        url=raw.get("url"),
        title=raw.get("title"),
        is_paid=raw.get("isPaid"),
        is_nsfw=raw.get("isNsfw"),
        preview_url=raw.get("previewUrl"),
    )


@dataclass
class DisplayMedia:
    is_nsfw: Optional[bool] = None
    media_sources: Optional[List[MediaSource]] = None


def display_media_from_raw(raw: Dict[str, Any]) -> DisplayMedia:
    return DisplayMedia(is_nsfw=raw.get("isNsfw"), media_sources=_sources(raw.get("mediaSources")))


@dataclass
class Subreddit:
    """Subreddit selection (fragment ``d``; J-shaped objects parse loosely)."""

    id: Optional[int] = None
    url: Optional[str] = None
    title: Optional[str] = None
    secondary_title: Optional[str] = None
    description: Optional[str] = None
    created_at: Optional[str] = None
    is_nsfw: Optional[bool] = None
    subscribers: Optional[int] = None
    is_complete: Optional[bool] = None
    item_count: Optional[int] = None
    video_count: Optional[int] = None
    picture_count: Optional[int] = None
    album_count: Optional[int] = None
    is_paid: Optional[bool] = None
    username: Optional[str] = None
    tags: Optional[List[str]] = None
    banner: Optional[MediaSource] = None
    display_media: Optional[DisplayMedia] = None
    is_following: Optional[bool] = None
    more_subreddits: Optional[List[MoreSubreddit]] = None
    children_iterator: Optional[str] = None
    children: Optional[List[Post]] = None
    preview_url: Optional[str] = None  # present on resolve/subreddit search results
    raw: Dict[str, Any] = field(default_factory=dict)


def subreddit_from_raw(raw: Dict[str, Any]) -> Subreddit:
    banner = raw.get("banner")
    children_raw = raw.get("children")
    children_raw = children_raw if isinstance(children_raw, dict) else {}
    return Subreddit(
        id=raw.get("id"),
        url=raw.get("url"),
        title=raw.get("title"),
        secondary_title=pick(raw, "secondaryTitle", "secondary_title"),
        description=raw.get("description"),
        created_at=raw.get("createdAt"),
        is_nsfw=pick(raw, "isNsfw", "is_nsfw"),
        subscribers=raw.get("subscribers"),
        is_complete=raw.get("isComplete"),
        item_count=pick(raw, "itemCount", "item_count"),
        video_count=raw.get("videoCount"),
        picture_count=raw.get("pictureCount"),
        album_count=raw.get("albumCount"),
        is_paid=pick(raw, "isPaid", "is_paid"),
        username=raw.get("username"),
        tags=raw.get("tags"),
        banner=media_source_from_raw(banner) if isinstance(banner, dict) else None,
        display_media=(
            display_media_from_raw(raw["displayMedia"])
            if isinstance(raw.get("displayMedia"), dict)
            else None
        ),
        is_following=pick(raw, "isFollowing", "is_following"),
        more_subreddits=_parse_list(raw.get("moreSubreddits"), more_subreddit_from_raw),
        children_iterator=children_raw.get("iterator"),
        children=_parse_list(children_raw.get("items"), post_from_raw),
        preview_url=pick(raw, "previewUrl", "preview_url"),
        raw=dict(raw),
    )


@dataclass
class Collection:
    """User collection (GetUserCollection/GetCollectionById selections, loose)."""

    id: Optional[int] = None
    tag: Optional[str] = None
    title: Optional[str] = None
    url: Optional[str] = None
    description: Optional[str] = None
    is_private: Optional[bool] = None
    is_nsfw: Optional[bool] = None
    user_account_id: Optional[int] = None
    is_following: Optional[bool] = None
    item_count: Optional[int] = None
    post_ids: Optional[List[int]] = None
    preview_url: Optional[str] = None
    raw: Dict[str, Any] = field(default_factory=dict)


def collection_from_raw(raw: Dict[str, Any]) -> Collection:
    posts = raw.get("posts")
    post_ids = None
    if isinstance(posts, list):
        post_ids = [p.get("id") for p in posts if isinstance(p, dict)]
    return Collection(
        id=raw.get("id"),
        tag=raw.get("tag"),
        title=raw.get("title"),
        url=raw.get("url"),
        description=raw.get("description"),
        is_private=pick(raw, "is_private", "isPrivate"),
        is_nsfw=pick(raw, "is_nsfw", "isNsfw"),
        user_account_id=raw.get("user_account_id"),
        is_following=raw.get("is_following"),
        item_count=raw.get("item_count"),
        post_ids=post_ids,
        preview_url=pick(raw, "previewUrl", "preview_url"),
        raw=dict(raw),
    )


# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------


@dataclass
class CommentUser:
    id: Optional[int] = None
    username: Optional[str] = None
    avatar: Optional[str] = None
    is_premium: Optional[bool] = None


def comment_user_from_raw(raw: Dict[str, Any]) -> CommentUser:
    return CommentUser(
        id=raw.get("id"),
        username=raw.get("username"),
        avatar=raw.get("avatar"),
        is_premium=raw.get("is_premium"),
    )


@dataclass
class Comment:
    id: Optional[int] = None
    content: Optional[str] = None
    likes_count: Optional[int] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    deleted_at: Optional[str] = None
    user_account: Optional[CommentUser] = None
    replies_count: Optional[int] = None
    is_liked: Optional[bool] = None
    raw: Dict[str, Any] = field(default_factory=dict)


def comment_from_raw(raw: Dict[str, Any]) -> Comment:
    user = raw.get("user_account")
    return Comment(
        id=raw.get("id"),
        content=raw.get("content"),
        likes_count=raw.get("likes_count"),
        created_at=raw.get("created_at"),
        updated_at=raw.get("updated_at"),
        deleted_at=raw.get("deleted_at"),
        user_account=comment_user_from_raw(user) if isinstance(user, dict) else None,
        replies_count=raw.get("replies_count"),
        is_liked=raw.get("is_liked"),
        raw=dict(raw),
    )


@dataclass
class CreatedComment:
    """createComment / createCommentReply / deleteComment result."""

    id: Optional[int] = None
    post_comments_count: Optional[int] = None
    post_comments_replies_count: Optional[int] = None
    raw: Dict[str, Any] = field(default_factory=dict)


def created_comment_from_raw(raw: Any) -> CreatedComment:
    raw = raw if isinstance(raw, dict) else {}
    return CreatedComment(
        id=raw.get("id"),
        post_comments_count=raw.get("postCommentsCount"),
        post_comments_replies_count=raw.get("postCommentsRepliesCount"),
        raw=dict(raw),
    )


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


@dataclass
class UserBrief:
    id: Optional[int] = None
    username: Optional[str] = None
    avatar: Optional[str] = None
    is_reddit_account: Optional[bool] = None


def user_brief_from_raw(raw: Dict[str, Any]) -> UserBrief:
    return UserBrief(
        id=raw.get("id"),
        username=raw.get("username"),
        avatar=raw.get("avatar"),
        is_reddit_account=raw.get("is_reddit_account"),
    )


@dataclass
class LoggedInUser:
    """getLoggedInUser selection (loose)."""

    id: Optional[int] = None
    username: Optional[str] = None
    email: Optional[str] = None
    premium_ends: Optional[str] = None
    created_at: Optional[str] = None
    email_verified_at: Optional[str] = None
    age_verified_at: Optional[str] = None
    phone_verified_at: Optional[str] = None
    last_active_at: Optional[str] = None
    is_premium: Optional[bool] = None
    social_type: Optional[str] = None
    deleted_at: Optional[str] = None
    has_leaderboard_entry: Optional[bool] = None
    cta_closed_at: Optional[str] = None
    leaderboard_visited_at: Optional[str] = None
    settings: Optional[Dict[str, Any]] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone_number: Optional[str] = None
    bio: Optional[str] = None
    birthday: Optional[str] = None
    display_name: Optional[str] = None
    location: Optional[str] = None
    banner_image: Optional[str] = None
    avatar: Optional[str] = None
    wishlist: Optional[Any] = None
    video_intro: Optional[str] = None
    social_media: Optional[Dict[str, Any]] = None
    raw: Dict[str, Any] = field(default_factory=dict)


def user_from_raw(raw: Dict[str, Any]) -> LoggedInUser:
    return LoggedInUser(
        id=raw.get("id"),
        username=raw.get("username"),
        email=raw.get("email"),
        premium_ends=raw.get("premium_ends"),
        created_at=raw.get("created_at"),
        email_verified_at=raw.get("email_verified_at"),
        age_verified_at=raw.get("age_verified_at"),
        phone_verified_at=raw.get("phone_verified_at"),
        last_active_at=raw.get("last_active_at"),
        is_premium=raw.get("isPremium"),
        social_type=raw.get("socialType"),
        deleted_at=raw.get("deleted_at"),
        has_leaderboard_entry=raw.get("hasLeaderboardEntry"),
        cta_closed_at=raw.get("cta_closed_at"),
        leaderboard_visited_at=raw.get("leaderboard_visited_at"),
        settings=raw.get("settings") if isinstance(raw.get("settings"), dict) else None,
        first_name=raw.get("first_name"),
        last_name=raw.get("last_name"),
        phone_number=raw.get("phone_number"),
        bio=raw.get("bio"),
        birthday=raw.get("birthday"),
        display_name=raw.get("display_name"),
        location=raw.get("location"),
        banner_image=raw.get("banner_image"),
        avatar=raw.get("avatar"),
        wishlist=raw.get("wishlist"),
        video_intro=raw.get("video_intro"),
        social_media=(
            raw.get("social_media") if isinstance(raw.get("social_media"), dict) else None
        ),
        raw=dict(raw),
    )


@dataclass
class LoginResult:
    """login(username, password) result; ``token``/``expires_at`` are persisted."""

    username: Optional[str] = None
    token: Optional[str] = None
    expires_at: Optional[int] = None
    is_admin: Optional[bool] = None
    is_premium: Optional[bool] = None
    deleted_at: Optional[str] = None
    raw: Dict[str, Any] = field(default_factory=dict)


def login_result_from_raw(raw: Dict[str, Any]) -> LoginResult:
    return LoginResult(
        username=raw.get("username"),
        token=raw.get("token"),
        expires_at=raw.get("expiresAt"),
        is_admin=raw.get("isAdmin"),
        is_premium=raw.get("isPremium"),
        deleted_at=raw.get("deleted_at"),
        raw=dict(raw),
    )


@dataclass
class SearchUser:
    id: Optional[int] = None
    username: Optional[str] = None
    description: Optional[str] = None
    avatar: Optional[str] = None
    is_following: Optional[bool] = None
    is_current_user: Optional[bool] = None
    display_name: Optional[str] = None
    raw: Dict[str, Any] = field(default_factory=dict)


def search_user_from_raw(raw: Dict[str, Any]) -> SearchUser:
    return SearchUser(
        id=raw.get("id"),
        username=raw.get("username"),
        description=raw.get("description"),
        avatar=raw.get("avatar"),
        is_following=raw.get("isFollowing"),
        is_current_user=raw.get("isCurrentUser"),
        display_name=raw.get("displayName"),
        raw=dict(raw),
    )


@dataclass
class SubredditSearchResult:
    """searchSubreddits / searchSubredditWithPreview rows (loose both namings)."""

    id: Optional[int] = None
    title: Optional[str] = None
    secondary_title: Optional[str] = None
    url: Optional[str] = None
    description: Optional[str] = None
    is_nsfw: Optional[bool] = None
    item_count: Optional[int] = None
    preview_images: Optional[List[MediaSource]] = None  # searchSubreddits (list)
    preview_image: Optional[MediaSource] = None  # searchSubredditWithPreview (single)
    raw: Dict[str, Any] = field(default_factory=dict)


def subreddit_search_result_from_raw(raw: Dict[str, Any]) -> SubredditSearchResult:
    preview_image = raw.get("previewImage")
    return SubredditSearchResult(
        id=raw.get("id"),
        title=raw.get("title"),
        secondary_title=pick(raw, "secondary_title", "secondaryTitle"),
        url=raw.get("url"),
        description=raw.get("description"),
        is_nsfw=pick(raw, "is_nsfw", "isNsfw"),
        item_count=pick(raw, "item_count", "itemCount"),
        preview_images=_sources(raw.get("preview_images")),
        preview_image=(
            media_source_from_raw(preview_image) if isinstance(preview_image, dict) else None
        ),
        raw=dict(raw),
    )


# ---------------------------------------------------------------------------
# Messaging / notifications
# ---------------------------------------------------------------------------


@dataclass
class Message:
    id: Optional[int] = None
    content: Optional[str] = None
    sender_id: Optional[int] = None
    receiver_id: Optional[int] = None
    sender: Optional[UserBrief] = None
    read_at: Optional[str] = None
    created_at: Optional[str] = None
    raw: Dict[str, Any] = field(default_factory=dict)


def message_from_raw(raw: Dict[str, Any]) -> Message:
    sender = raw.get("sender")
    return Message(
        id=raw.get("id"),
        content=raw.get("content"),
        sender_id=raw.get("sender_id"),
        receiver_id=raw.get("receiver_id"),
        sender=user_brief_from_raw(sender) if isinstance(sender, dict) else None,
        read_at=raw.get("read_at"),
        created_at=raw.get("created_at"),
        raw=dict(raw),
    )


@dataclass
class Conversation:
    user: Optional[UserBrief] = None
    last_message: Optional[Message] = None
    unread_count: Optional[int] = None
    raw: Dict[str, Any] = field(default_factory=dict)


def conversation_from_raw(raw: Dict[str, Any]) -> Conversation:
    user = raw.get("user")
    last_message = raw.get("last_message")
    return Conversation(
        user=user_brief_from_raw(user) if isinstance(user, dict) else None,
        last_message=message_from_raw(last_message) if isinstance(last_message, dict) else None,
        unread_count=raw.get("unread_count"),
        raw=dict(raw),
    )


@dataclass
class Notification:
    id: Optional[int] = None
    title: Optional[str] = None
    content: Optional[str] = None
    url: Optional[str] = None
    updated_at: Optional[str] = None
    created_at: Optional[str] = None
    viewed_at: Optional[str] = None
    archived_at: Optional[str] = None
    raw: Dict[str, Any] = field(default_factory=dict)


def notification_from_raw(raw: Dict[str, Any]) -> Notification:
    return Notification(
        id=raw.get("id"),
        title=raw.get("title"),
        content=raw.get("content"),
        url=raw.get("url"),
        updated_at=raw.get("updatedAt"),
        created_at=raw.get("createdAt"),
        viewed_at=raw.get("viewedAt"),
        archived_at=raw.get("archivedAt"),
        raw=dict(raw),
    )


# ---------------------------------------------------------------------------
# Social / moderation
# ---------------------------------------------------------------------------


@dataclass
class HideRule:
    id: Optional[int] = None
    content_type: Optional[str] = None  # POST | SUBREDDIT
    target_id: Optional[int] = None
    created_at: Optional[str] = None
    url: Optional[str] = None  # only in ...WithUrl variant
    subreddit_title: Optional[str] = None
    is_nsfw: Optional[bool] = None
    raw: Dict[str, Any] = field(default_factory=dict)


def hide_rule_from_raw(raw: Dict[str, Any]) -> HideRule:
    return HideRule(
        id=raw.get("id"),
        content_type=raw.get("contentType"),
        target_id=raw.get("targetId"),
        created_at=raw.get("createdAt"),
        url=raw.get("url"),
        subreddit_title=raw.get("subredditTitle"),
        is_nsfw=raw.get("isNsfw"),
        raw=dict(raw),
    )


@dataclass
class FollowingFlag:
    id: Optional[int] = None
    is_following: Optional[bool] = None


@dataclass
class FollowingContent:
    subreddit_urls: List[str] = field(default_factory=list)
    collection_urls: List[str] = field(default_factory=list)


def following_content_from_raw(raw: Dict[str, Any]) -> FollowingContent:
    def urls(key: str, field_name: str) -> List[str]:
        entries = raw.get(key)
        if not isinstance(entries, list):
            return []
        return [e.get(field_name) for e in entries if isinstance(e, dict) and e.get(field_name)]

    return FollowingContent(
        subreddit_urls=urls("subreddits", "subredditUrl"),
        collection_urls=urls("collections", "collectionUrl"),
    )


@dataclass
class ResolvedLink:
    """resolveScrolllerLinks row; exactly one of post/subreddit/collection is set."""

    url: Optional[str] = None
    type: Optional[str] = None
    post: Optional[Post] = None
    subreddit: Optional[Subreddit] = None
    collection: Optional[Collection] = None
    raw: Dict[str, Any] = field(default_factory=dict)


def resolved_link_from_raw(raw: Dict[str, Any]) -> ResolvedLink:
    post = raw.get("post")
    subreddit = raw.get("subreddit")
    collection = raw.get("collection")
    return ResolvedLink(
        url=raw.get("url"),
        type=raw.get("type"),
        post=post_from_raw(post) if isinstance(post, dict) else None,
        subreddit=subreddit_from_raw(subreddit) if isinstance(subreddit, dict) else None,
        collection=collection_from_raw(collection) if isinstance(collection, dict) else None,
        raw=dict(raw),
    )


# ---------------------------------------------------------------------------
# Billing / subscriptions / creator (read-only surface)
# ---------------------------------------------------------------------------


@dataclass
class Plan:
    id: Optional[int] = None
    offer_id: Optional[int] = None
    product_id: Optional[int] = None
    name: Optional[str] = None
    billing_model_id: Optional[int] = None
    interval: Optional[str] = None
    amount: Optional[float] = None
    raw: Dict[str, Any] = field(default_factory=dict)


def plan_from_raw(raw: Dict[str, Any]) -> Plan:
    return Plan(
        id=raw.get("id"),
        offer_id=raw.get("offer_id"),
        product_id=raw.get("product_id"),
        name=raw.get("name"),
        billing_model_id=raw.get("billing_model_id"),
        interval=raw.get("interval"),
        amount=raw.get("amount"),
        raw=dict(raw),
    )


@dataclass
class AccountCard:
    card_last4: Optional[str] = None
    card_type: Optional[str] = None
    card_exp_month: Optional[int] = None
    card_exp_year: Optional[int] = None
    raw: Dict[str, Any] = field(default_factory=dict)


def account_from_raw(raw: Dict[str, Any]) -> AccountCard:
    return AccountCard(
        card_last4=raw.get("card_last4"),
        card_type=raw.get("card_type"),
        card_exp_month=raw.get("card_exp_month"),
        card_exp_year=raw.get("card_exp_year"),
        raw=dict(raw),
    )


@dataclass
class SubscriptionInfo:
    id: Optional[int] = None
    status: Optional[str] = None
    plan_name: Optional[str] = None
    interval: Optional[str] = None
    next_recurring: Optional[str] = None
    ends_at: Optional[str] = None
    product_id: Optional[int] = None
    payment_method: Optional[str] = None
    price: Optional[float] = None
    can_manage_subscription: Optional[bool] = None
    collection_subscriptions: Optional[List["CollectionSubscription"]] = None
    raw: Dict[str, Any] = field(default_factory=dict)


@dataclass
class CollectionSubscription:
    id: Optional[int] = None
    status: Optional[str] = None
    plan_name: Optional[str] = None
    interval: Optional[str] = None
    next_recurring: Optional[str] = None
    ends_at: Optional[str] = None
    product_id: Optional[int] = None
    payment_method: Optional[str] = None
    price: Optional[float] = None
    can_manage_subscription: Optional[bool] = None
    creator_name: Optional[str] = None
    raw: Dict[str, Any] = field(default_factory=dict)


def collection_subscription_from_raw(raw: Dict[str, Any]) -> CollectionSubscription:
    return CollectionSubscription(
        id=raw.get("id"),
        status=raw.get("status"),
        plan_name=raw.get("planName"),
        interval=raw.get("interval"),
        next_recurring=raw.get("next_recurring"),
        ends_at=raw.get("ends_at"),
        product_id=raw.get("product_id"),
        payment_method=raw.get("payment_method"),
        price=raw.get("price"),
        can_manage_subscription=raw.get("canManageSubscription"),
        creator_name=raw.get("creatorName"),
        raw=dict(raw),
    )


def subscription_from_raw(raw: Dict[str, Any]) -> SubscriptionInfo:
    return SubscriptionInfo(
        id=raw.get("id"),
        status=raw.get("status"),
        plan_name=raw.get("planName"),
        interval=raw.get("interval"),
        next_recurring=raw.get("next_recurring"),
        ends_at=raw.get("ends_at"),
        product_id=raw.get("product_id"),
        payment_method=raw.get("payment_method"),
        price=raw.get("price"),
        can_manage_subscription=raw.get("canManageSubscription"),
        collection_subscriptions=_parse_list(
            raw.get("collectionSubscriptions"), collection_subscription_from_raw
        ),
        raw=dict(raw),
    )


@dataclass
class CreatorReport:
    """getCreatorReport result (nested day series kept as list-of-dicts)."""

    revenue_by_day: Optional[List[Dict[str, Any]]] = None
    revenue_total: Optional[float] = None
    revenue_available: Optional[float] = None
    subscribers_by_day: Optional[List[Dict[str, Any]]] = None
    subscribers_total: Optional[int] = None
    impressions_total: Optional[int] = None
    impressions_by_day: Optional[List[Dict[str, Any]]] = None
    collection_impressions_total: Optional[int] = None
    collection_impressions_by_day: Optional[List[Dict[str, Any]]] = None
    checkout_impressions_total: Optional[int] = None
    checkout_impressions_by_day: Optional[List[Dict[str, Any]]] = None
    raw: Dict[str, Any] = field(default_factory=dict)


def creator_report_from_raw(raw: Dict[str, Any]) -> CreatorReport:
    def dicts(value: Any) -> Optional[List[Dict[str, Any]]]:
        if not isinstance(value, list):
            return None
        return [item for item in value if isinstance(item, dict)]

    return CreatorReport(
        revenue_by_day=dicts(raw.get("revenueByDay")),
        revenue_total=raw.get("revenueTotal"),
        revenue_available=raw.get("revenueAvailable"),
        subscribers_by_day=dicts(raw.get("subscribersByDay")),
        subscribers_total=raw.get("subscribersTotal"),
        impressions_total=raw.get("impressionsTotal"),
        impressions_by_day=dicts(raw.get("impressionsByDay")),
        collection_impressions_total=raw.get("collectionImpressionsTotal"),
        collection_impressions_by_day=dicts(raw.get("collectionImpressionsByDay")),
        checkout_impressions_total=raw.get("checkoutImpressionsTotal"),
        checkout_impressions_by_day=dicts(raw.get("checkoutImpressionsByDay")),
        raw=dict(raw),
    )


@dataclass
class CollectionSetup:
    """getCollectionSetup result (loose; nested dicts kept raw)."""

    collection: Optional[Dict[str, Any]] = None
    offer: Optional[Dict[str, Any]] = None
    owner: Optional[Dict[str, Any]] = None
    has_access: Optional[bool] = None
    status: Optional[str] = None
    raw: Dict[str, Any] = field(default_factory=dict)


def collection_setup_from_raw(raw: Dict[str, Any]) -> CollectionSetup:
    return CollectionSetup(
        collection=raw.get("collection") if isinstance(raw.get("collection"), dict) else None,
        offer=raw.get("offer") if isinstance(raw.get("offer"), dict) else None,
        owner=raw.get("owner") if isinstance(raw.get("owner"), dict) else None,
        has_access=raw.get("hasAccess"),
        status=raw.get("status"),
        raw=dict(raw),
    )


@dataclass
class UploadResult:
    """Response of the ``PUT https://host8.scrolller.com/upload`` helper."""

    url: Optional[str] = None
    source_set_id: Optional[int] = None
    raw: Dict[str, Any] = field(default_factory=dict)

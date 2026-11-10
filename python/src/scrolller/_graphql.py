"""Verbatim GraphQL documents (docs/api/T1-RESEARCH-FULL.md §3/§4 — authoritative).

Every field name below is copied verbatim from the site bundles as transcribed
in T1-RESEARCH-FULL.md. The site collapses whitespace before sending
(``query.replace(/\\s+/g, " ")``), so documents here are written as compact
one-liners with identical tokens. Fragments (t/Z/r/J/d/_) that the site
builds by JS string concatenation are expanded inline via the builder
functions below, exactly as the site does.

Nothing here is invented. Known caveats (T1 §8.5): several documents declare
variables they do not use — the server tolerates them; the texts are reused
as-is.
"""

from __future__ import annotations

import enum
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Enum coercion helpers (GallerySortBy / GalleryFilter / NsfwFilter values)
# ---------------------------------------------------------------------------


def enum_value(value: Any) -> Optional[str]:
    """Accept enum members or plain strings; return the GraphQL enum string."""
    if value is None or isinstance(value, str):
        return value
    if isinstance(value, enum.Enum):
        return value.value
    return str(value)


# ---------------------------------------------------------------------------
# Fragment builders (T1-RESEARCH-FULL.md §3 "Shared fragments" + §4)
# ---------------------------------------------------------------------------

# t(withBlurred) — media source selection
MEDIA_SOURCES_FIELDS = "mediaSources { url width height isOptimized type }"
BLURRED_MEDIA_SOURCES_FIELDS = "blurredMediaSources { url width height isOptimized type }"


def post_fields() -> str:
    """Fragment ``Z`` — post fields with ``withUserData=true`` (the default)."""
    return (
        "__typename id url title reddit_posted_by subredditId subredditTitle "
        "subredditUrl subredditIsFollowing redditPath isNsfw hasAudio "
        "fullLengthSource gfycatSource redgifsSource ownerAvatar username "
        "displayName userType favoriteCount repostCount isPaid tags "
        "commentsCount commentsRepliesCount duration createdAt "
        "albumContent { " + MEDIA_SOURCES_FIELDS + " } "
        "isFavorite isReposted "
        + MEDIA_SOURCES_FIELDS + " "
        + BLURRED_MEDIA_SOURCES_FIELDS
    )


def post_fields_with_meta() -> str:
    """Z + the extra fields SubredditPostQuery adds (withParent=true variant)."""
    return post_fields() + " altText description tagLinks { label url } hiddenTagCount"


def children_fields() -> str:
    """Fragment ``r`` — children carry NO server-side arguments (T1 §3 note)."""
    return "children { iterator items { " + post_fields() + " } }"


def subreddit_own_fields(with_children: bool = True) -> str:
    """Fragment ``J`` — subreddit/collection "own object" fields."""
    fields = "__typename id url title description is_private is_nsfw is_following"
    if with_children:
        fields += " " + children_fields()
    return fields


def subreddit_fields(
    with_children: bool = True,
    with_user_data: bool = True,
    is_subreddit: bool = True,
    with_display_media: bool = False,
) -> str:
    """Fragment ``d`` — "parent" subreddit fields with the site's build options."""
    fields = (
        "__typename id url title secondaryTitle description createdAt isNsfw "
        "subscribers isComplete itemCount videoCount pictureCount albumCount"
    )
    if is_subreddit:
        fields += " isPaid username tags banner { url width height isOptimized }"
    if with_display_media:
        fields += " displayMedia { isNsfw " + MEDIA_SOURCES_FIELDS + " }"
    if with_user_data:
        fields += " isFollowing moreSubreddits { id url title isPaid isNsfw previewUrl }"
    if with_children:
        fields += " " + children_fields()
    return fields


def subscription_fields() -> str:
    """Fragment ``_`` — subscription fields."""
    return (
        "id status planName interval next_recurring ends_at product_id "
        "payment_method price canManageSubscription"
    )


def message_fields() -> str:
    """Message field fragment (T1 §3f, module 957931)."""
    return (
        "id content sender_id receiver_id "
        "sender { id username avatar is_reddit_account } "
        "read_at created_at"
    )


def comment_fields() -> str:
    """Comment reader fields (T1 §3e)."""
    return (
        "id content likes_count created_at updated_at deleted_at "
        "user_account { id username avatar is_premium } "
        "replies_count is_liked"
    )


def paid_collections_document(limit: int, is_nsfw: bool) -> str:
    """``PaidCollections`` — ``limit``/``isNsfw`` are interpolated literals on
    the site (defaults limit 10, isNsfw false), so the text is built per call
    (T1 §3c)."""
    return (
        "query PaidCollections($iterator: String) { "
        "getMyPaidCollections(isNsfw: %s limit: %d iterator: $iterator) { "
        "iterator items { %s } } }"
    ) % ("true" if is_nsfw else "false", int(limit), subreddit_fields(with_children=False))


# ---------------------------------------------------------------------------
# Media / feed / search (T1 §3a, §3b)
# ---------------------------------------------------------------------------

Q_DISCOVER = (
    "query DiscoverFilteredSubredditsQuery("
    "$filter: GalleryFilter $sortBy: GallerySortBy $limit: Int! $childLimit: Int! "
    "$iterator: String $includeFilters: [Int!] $excludeFilters: [Int!] $nsfw: NsfwFilter"
    ") { discoverFilteredSubreddits(data: { nsfw: $nsfw filter: $filter limit: $limit "
    "childLimit: $childLimit iterator: $iterator includeFilters: $includeFilters "
    "excludeFilters: $excludeFilters sortBy: $sortBy }) { iterator recommendationType "
    "hasV1Recommendations hasV2Recommendations items { "
    + subreddit_fields(with_children=True) + " } } }"
)

Q_GET_CATEGORIES = (
    "query getCategories($sort: String, $nsfw: Boolean!,) { "
    "categories(data: {order_by: $sort, is_nsfw: $nsfw,}) { "
    "title elements { title elements { title elements { title elements { title } } } } } }"
)

Q_SUBREDDIT = (
    "query SubredditQuery("
    "$url: String! $iterator: String $sortBy: GallerySortBy $filter: GalleryFilter $limit: Int!"
    ") { getSubreddit(data: {url: $url, iterator: $iterator, filter: $filter, "
    "limit: $limit, sortBy: $sortBy}) { " + subreddit_fields(with_children=True) + " } }"
)

Q_SUBREDDIT_CHILDREN = (
    "query SubredditChildrenQuery("
    "$subredditId: Int! $iterator: String $filter: GalleryFilter $sortBy: GallerySortBy "
    "$limit: Int! $nsfw: NsfwFilter"
    ") { getSubredditChildren(data: {subredditId: $subredditId, iterator: $iterator, "
    "filter: $filter, sortBy: $sortBy, limit: $limit, nsfw: $nsfw}) { iterator items { "
    + post_fields() + " } } }"
)

Q_SEARCH_SUBREDDITS = (
    "query SearchSubredditsQuery($query: String!, $limit: Int!, $isNsfw: Boolean!, "
    "$pageIndex: Int!) { searchSubreddits(data: { query: $query isNsfw: $isNsfw "
    "limit: $limit pageIndex: $pageIndex }) { id title url secondary_title description "
    "is_nsfw item_count preview_images { url width height } } }"
)

Q_SEARCH_SUBREDDIT_WITH_PREVIEW = (
    "query SearchSubredditWithPreview($query: String!, $limit: Int!, $pageIndex: Int!) { "
    "searchSubredditWithPreview(data: { query: $query limit: $limit pageIndex: $pageIndex })"
    " { title secondaryTitle url isNsfw itemCount previewImage { url width height } } }"
)

Q_SEARCH_USERS = (
    "query SearchUsersQuery($query: String!, $limit: Int!, $pageIndex: Int!) { "
    "searchUsers(data: { query: $query limit: $limit pageIndex: $pageIndex }) { "
    "id username description avatar isFollowing isCurrentUser displayName } }"
)

# ---------------------------------------------------------------------------
# Posts (T1 §3a, §3b, §3d)
# ---------------------------------------------------------------------------

Q_GET_POST = (
    "query SubredditPostQuery($url: String!) { getPost(data: { url: $url }) { "
    + post_fields_with_meta() + " } }"
)

Q_POST_HIDDEN_TAGS = (
    "query PostHiddenTags($postId: Int!) { getPostHiddenTags(postId: $postId) "
    "{ label url } }"
)

Q_RESOLVE_LINKS = (
    "query ResolveScrolllerLinks($urls: [String!]!) { resolveScrolllerLinks(urls: $urls) { "
    "url type post { id url title subredditId subredditUrl isPaid "
    + MEDIA_SOURCES_FIELDS + " " + BLURRED_MEDIA_SOURCES_FIELDS + " } "
    "subreddit { id url title isPaid isNsfw previewUrl } "
    "collection { id url title description is_nsfw item_count previewUrl } } }"
)

Q_GET_POST_RECOMMENDATIONS = (
    "query GetAllRecommendationsContent($postId: Int!) { "
    "getPostRecommendations(data: {postId: $postId}) { subreddits { subredditUrl } } }"
)

Q_POSTS_BY_TAG = (
    "query PostsByTag($data: PostsByTagInput!) { getPostsByTag(data: $data) { "
    "iterator items { " + post_fields_with_meta() + " } } }"
)

Q_GET_POSTS_BY_CREATORS = (
    "query GetPostsByCreators($iterator: String $filter: GalleryFilter "
    "$sortBy: GallerySortBy $limit: Int! $nsfw: NsfwFilter) { "
    "getPostsByCreators(data: { limit: $limit iterator: $iterator filter: $filter "
    "sortBy: $sortBy nsfw: $nsfw }) { iterator items { " + post_fields() + " } } }"
)

Q_USER_POSTS = (
    "query UserPostsQuery($username: String! $iterator: String $limit: Int! "
    "$filter: GalleryFilter $sortBy: GallerySortBy $nsfw: NsfwFilter) { "
    "getUserPosts(data: { username: $username iterator: $iterator limit: $limit "
    "filter: $filter sortBy: $sortBy nsfw: $nsfw }) { iterator items { "
    + post_fields() + " } } }"
)

Q_REDDIT_USER_POSTS = (
    "query RedditUserPostsQuery($username: String! $iterator: String $limit: Int! "
    "$filter: GalleryFilter $sortBy: GallerySortBy $nsfw: NsfwFilter) { "
    "getRedditUserPosts(data: { username: $username iterator: $iterator limit: $limit "
    "filter: $filter sortBy: $sortBy nsfw: $nsfw }) { iterator items { "
    + post_fields() + " } } }"
)

# ---------------------------------------------------------------------------
# Comments (T1 §3e — readers return PLAIN ARRAYS)
# ---------------------------------------------------------------------------

Q_GET_COMMENTS = (
    "query getCommentsQuery($post_id: Int!, $pagination: CommentPaginationInput!) { "
    "getComments(data: { post_id: $post_id pagination: $pagination }) { "
    + comment_fields() + " } }"
)

Q_GET_REPLIES_FROM_COMMENT = (
    "query getRepliesFromCommentQuery($comment_id: Int!, $pagination: CommentPaginationInput!) { "
    "getRepliesFromComment(data: { comment_id: $comment_id pagination: $pagination }) { "
    + comment_fields() + " } }"
)

Q_CREATE_COMMENT = (
    "mutation createComment($content: String!, $post_id: Int!) { "
    "createComment(data: {content: $content, post_id: $post_id}) { "
    "id postCommentsCount postCommentsRepliesCount } }"
)

Q_CREATE_COMMENT_REPLY = (
    "mutation createCommentReply($content: String!, $parent_comment_id: Int!) { "
    "createCommentReply(data: {content: $content, parent_comment_id: $parent_comment_id}) { "
    "id postCommentsCount postCommentsRepliesCount } }"
)

Q_LIKE_COMMENT = "mutation likeComment($id: Int!) { likeComment(id: $id) }"

Q_UNLIKE_COMMENT = "mutation unlikeComment($id: Int!) { unlikeComment(id: $id) }"

Q_DELETE_COMMENT = (
    "mutation deleteComment($id: Int!) { deleteComment(id: $id) { "
    "id postCommentsCount postCommentsRepliesCount } }"
)

Q_REPORT_COMMENT = (
    "mutation reportComment($commentId: Int!, $reason: String!, $details: String) { "
    "reportComment(data: {commentId: $commentId, reason: $reason, details: $details}) }"
)

# ---------------------------------------------------------------------------
# Favorites / reposts / sound (T1 §3h)
# ---------------------------------------------------------------------------

Q_ADD_FAVORITE = "mutation AddFavorite($url: String!) { addFavorite(url: $url) }"

Q_REMOVE_FAVORITE = "mutation RemoveFavorite($url: String!) { removeFavorite(url: $url) }"

Q_GET_POST_IS_FAVORITE = "query GetPostIsFavorite($url: String!) { getPostIsFavorite(url: $url) }"

Q_REPOST_POST = "mutation RepostPost($url: String!) { repostPost(url: $url) }"

Q_REMOVE_REPOST = "mutation RemoveRepost($url: String!) { removeRepost(url: $url) }"

Q_MARK_POST_WITH_SOUND = (
    "mutation MarkPostWithSound($postId: Int!, $hasAudio: Boolean!) { "
    "addWithSound(postId: $postId, hasAudio: $hasAudio) }"
)

# ---------------------------------------------------------------------------
# Hide rules (T1 §3i; contentType enum POST | SUBREDDIT)
# ---------------------------------------------------------------------------

Q_HIDE_CONTENT = (
    "mutation HideContent($data: HideContentInput!) { hideContent(data: $data) { "
    "rule { id contentType targetId createdAt } } }"
)

Q_UNHIDE_CONTENT = "mutation UnhideContent($data: UnhideContentInput!) { unhideContent(data: $data) }"

Q_GET_HIDE_RULES = (
    "query GetUserHideContentRules { getUserHideContentRules { "
    "id contentType targetId createdAt } }"
)

Q_GET_HIDE_RULES_WITH_URL = (
    "query GetUserHideContentRulesWithUrl { getUserHideContentRulesWithUrl { "
    "id contentType targetId createdAt url subredditTitle isNsfw } }"
)

# ---------------------------------------------------------------------------
# Reports (T1 §3j)
# ---------------------------------------------------------------------------

Q_REPORT_POST = (
    "mutation ReportPost($postId: Int!, $reason: String!, $details: String) { "
    "reportPost(data: { postId: $postId, reason: $reason, details: $details }) }"
)

Q_REPORT_COLLECTION = (
    "mutation ReportCollection($collectionId: Int!, $reason: String!, $details: String) { "
    "reportCollection(data: { collectionId: $collectionId, reason: $reason, details: $details }) }"
)

Q_REPORT_USER = (
    "mutation ReportUser($userId: Int!, $reason: String!, $details: String) { "
    "reportUser(data: { userId: $userId, reason: $reason, details: $details }) }"
)

# ---------------------------------------------------------------------------
# Follow (T1 §3d — note: the unfollow document is shipped verbatim with the
# operation name "Follow" in the bundle; only the field differs)
# ---------------------------------------------------------------------------

Q_FOLLOW = "mutation Follow($url: String!) { follow(url: $url) }"

Q_UNFOLLOW = "mutation Follow($url: String!) { unfollow(url: $url) }"

Q_GET_IS_FOLLOWING_SUBREDDIT = (
    "query GetIsFollowingSubreddit($ids: [Int!]!) { getIsFollowingSubreddit(ids: $ids) { "
    "id isFollowing } }"
)

Q_GET_IS_FOLLOWING_USER = (
    "query GetIsFollowingUser($id: Int, $username: String) { "
    "getIsFollowingUser(id: $id, username: $username) { isFollowing } }"
)

Q_GET_IS_FOLLOWING_USER_COLLECTION = (
    "query GetIsFollowingUserCollection($id: Int!) { "
    "getIsFollowingUserCollection(id: $id) }"
)

Q_GET_ALL_FOLLOWING_CONTENT = (
    "query GetAllFollowingContent { getAllFollowingContent { "
    "subreddits { subredditUrl } collections { collectionUrl } } }"
)

Q_GET_FOLLOWING_SUBREDDITS = (
    "query GetFollowingSubreddits ($iterator: String, $limit: Int!, $filter: GalleryFilter, "
    "$nsfw: NsfwFilter, $sortBy: GallerySortBy) { getFollowingSubreddits(data: { nsfw: $nsfw "
    "limit: $limit filter: $filter iterator: $iterator sortBy: $sortBy }) { iterator items { "
    + subreddit_fields(with_children=True, with_user_data=False, is_subreddit=False) + " } } }"
)

Q_GET_FOLLOWING_COLLECTIONS = (
    "query GetFollowingCollections ($iterator: String, $filter: GalleryFilter, "
    "$sortBy: GallerySortBy, $limit: Int!, $nsfw: NsfwFilter) { getFollowingCollections("
    "data: { nsfw: $nsfw limit: $limit iterator: $iterator filter: $filter "
    "sortBy: $sortBy }) { iterator items { "
    + subreddit_own_fields(with_children=True) + " } } }"
)

# ---------------------------------------------------------------------------
# Collections (T1 §3c, including the lazy-chunk operations)
# ---------------------------------------------------------------------------

Q_GET_USER_COLLECTIONS = (
    "query GetUserCollectionsQuery { getUserCollections { id title url is_nsfw "
    "is_private description posts { id } } }"
)

Q_GET_USER_COLLECTION = (
    "query GetUserCollectionQuery($url: String!) { getUserCollection(url: $url) { "
    "id tag title url description is_private is_nsfw user_account_id is_following "
    "item_count } }"
)

Q_GET_COLLECTION_BY_ID = (
    "query GetCollectionById($collectionId: Int!) { getCollection(id: $collectionId) { "
    "id title url description is_private is_nsfw user_account_id item_count "
    "is_following } }"
)

Q_GET_USER_COLLECTION_CONTENT = (
    "query getUserCollectionContentQuery($iterator: String $nsfw: NsfwFilter "
    "$filter: GalleryFilter $sortBy: GallerySortBy $limit: Int! $collectionId: Int!) { "
    "getUserCollectionContent(data: { nsfw: $nsfw limit: $limit sortBy: $sortBy "
    "filter: $filter iterator: $iterator collectionId: $collectionId }) { iterator "
    "items { " + post_fields() + " } } }"
)

Q_CREATE_COLLECTION = (
    "mutation CreateCollection($title: String!, $description: String, "
    "$is_private: Boolean! $is_nsfw: Boolean!) { createCollection(data: { title: $title, "
    "description: $description, is_private: $is_private, is_nsfw: $is_nsfw, }) { "
    "id title description url is_private is_nsfw } }"
)

Q_EDIT_COLLECTION = (
    "mutation EditCollection($id: Int!, $title: String!, $description: String, "
    "$is_private: Boolean! $is_nsfw: Boolean!) { editCollection(data: { id: $id, "
    "title: $title, description: $description, is_private: $is_private, "
    "is_nsfw: $is_nsfw, }) { id title description url is_private is_nsfw } }"
)

Q_DELETE_COLLECTION = "mutation DeleteCollection($id: Int!,) { deleteCollection(data: {id: $id,}) }"

Q_ADD_POST_TO_COLLECTION = (
    "mutation AddPostToCollection($postId: Int!, $collectionId: Int!) { "
    "addPostToCollection(data: { postId: $postId, collectionId: $collectionId }) }"
)

Q_REMOVE_POST_FROM_COLLECTION = (
    "mutation RemovePostFromCollection($postId: Int!, $collectionId: Int!) { "
    "removePostFromCollection(data: { postId: $postId, collectionId: $collectionId }) }"
)

Q_EDIT_CUSTOM_COLLECTION = (
    "mutation editCustomCollection($id: Int!, $url: String!, $title: String!, "
    "$description: String, $tags: String!, $isPaid: Boolean!, $isPrivate: Boolean!) { "
    "editSubreddit(data: { id: $id, url: $url, title: $title, description: $description, "
    "tags: $tags, isPaid: $isPaid, isPrivate: $isPrivate }) { id previewUrl url } }"
)

Q_DELETE_CUSTOM_COLLECTION = (
    "mutation deleteCustomCollection($collectionUrl: String!) { "
    "deleteSubreddit(collectionUrl: $collectionUrl) }"
)

Q_EDIT_COLLECTION_PREVIEW_URL = (
    "mutation editCollectionPreviewUrl($collectionUrl: String!, $previewUrl: String!) { "
    "editCollectionPreviewUrl(data: { collectionUrl: $collectionUrl, previewUrl: $previewUrl })"
    " { id url previewUrl } }"
)

Q_DELETE_COLLECTION_PREVIEW_URL = (
    "mutation deleteCollectionPreviewUrl($collectionId: Int!) { "
    "deleteCollectionPreviewUrl(collectionId: $collectionId) }"
)

Q_CREATE_COLLECTION_BILLING_OPTIONS = (
    "mutation createCollectionBillingOptions($collectionId: Int!, $amount: Float!, "
    "$type: String!) { createCollectionBillingOptions(collectionId: $collectionId, "
    "amount: $amount, type: $type) }"
)

# The bundle ships this mutation under the operation name "delete" (verbatim).
Q_DEACTIVATE_COLLECTION_BILLING_OPTIONS = (
    "mutation delete($collectionId: Int!) { "
    "deactivateCollectionBillingOptions(collectionId: $collectionId) }"
)

Q_GET_COLLECTION_SETUP = (
    "query getCollectionSetup ($collectionId:Int!) { getCollectionSetup(collectionId:$collectionId){ "
    "collection{ id title description secondary_title is_paid user_account_id item_count "
    "video_count picture_count subscribers } "
    "offer{ amount product_id campaign_id is_active type billing_model_id } "
    "owner{ username avatar displayName } hasAccess status } }"
)

Q_ADD_COLLECTION_IMPRESSION = (
    "mutation addCollectionImpression($subredditUrl: String, $collectionId: Int){ "
    "addCollectionImpression(subredditUrl: $subredditUrl, collectionId: $collectionId) }"
)

# ---------------------------------------------------------------------------
# Auth / account (T1 §2, §3d, §3k, §3l, §3m)
# ---------------------------------------------------------------------------

Q_LOGIN = (
    "query LoginQuery($username: String!, $password: String!) { "
    "login(username: $username, password: $password) { username token expiresAt "
    "isAdmin deleted_at isPremium } }"
)

Q_GET_LOGGED_IN_USER = (
    "query GetLoggedInUserQuery { getLoggedInUser { id username email premium_ends "
    "created_at email_verified_at age_verified_at phone_verified_at last_active_at "
    "isPremium socialType deleted_at hasLeaderboardEntry cta_closed_at "
    "leaderboard_visited_at settings{ id video_autoplay send_sfw send_nsfw preference "
    "nsfw_preference soft_delete send_comment_emails send_message_emails send_newsletter "
    "track_watch_history } first_name last_name phone_number bio birthday display_name "
    "location banner_image avatar wishlist video_intro social_media { instagram twitter "
    "tiktok snapchat personal_website } } }"
)

Q_UPDATE_USER = (
    "mutation UpdateUser($email: String, $username: String, $first_name: String, "
    "$last_name: String, $display_name: String, $location: String, $birthday: String, "
    "$bio: String) { updateUser(data: { email: $email, username: $username, "
    "first_name: $first_name, last_name: $last_name, display_name: $display_name, "
    "location: $location, birthday: $birthday, bio: $bio }) }"
)

Q_UPDATE_INFO = "mutation updateInfo { updateInfo }"

Q_PLAN = (
    "query PlanQuery { subscription_plans(orderBy:{id:asc}) { id offer_id product_id "
    "name billing_model_id interval amount } }"
)

Q_ACCOUNT = "query Account { myAccount{ card_last4 card_type card_exp_month card_exp_year } }"

Q_SUBSCRIPTION = (
    "query Subscription { mySubscription{ " + subscription_fields() + " "
    "collectionSubscriptions { " + subscription_fields() + " creatorName } } }"
)

Q_GET_REV_SHARE = "query getRevShare{ revShare }"

Q_GET_CREATOR_REPORT = (
    "query getCreatorReport { getCreatorReport{ revenueByDay{ amount day } "
    "revenueTotal revenueAvailable subscribersByDay{ amount day } subscribersTotal "
    "impressionsTotal impressionsByDay{ day amount } collectionImpressionsTotal "
    "collectionImpressionsByDay{ day amount } checkoutImpressionsTotal "
    "checkoutImpressionsByDay{ day amount } } }"
)

Q_ADD_CREATOR_POST = (
    "mutation addCreatorPost($title: String!, $keywords: String!, $isNsfw: Boolean!, "
    "$mediaUrl: String!, $subredditUrl: String!, $sourceSetId: Int!, $setHeader: Boolean!, "
    "$mediaType: String!) { uploadPostToSubreddit(data: { title: $title, keywords: $keywords, "
    "isNsfw: $isNsfw, mediaUrl: $mediaUrl, subredditUrl: $subredditUrl, "
    "sourceSetId: $sourceSetId, setHeader: $setHeader, mediaType: $mediaType }) { "
    "title url } }"
)

# ---------------------------------------------------------------------------
# Messaging / chat (T1 §3f)
# ---------------------------------------------------------------------------

Q_GET_MESSAGES = (
    "query GetMessages($data: GetMessagesInput!) { getMessages(data: $data) { "
    "items { " + message_fields() + " } total } }"
)

Q_GET_CONVERSATIONS = (
    "query GetConversations($data: GetConversationsInput!) { getConversations(data: $data) { "
    "items { user { id username avatar is_reddit_account } last_message { "
    + message_fields() + " } unread_count } next_cursor } }"
)

Q_SEND_MESSAGE = (
    "mutation SendMessage($data: SendMessageInput!) { sendMessage(data: $data) { "
    "id content sender_id receiver_id sender { id username avatar } read_at "
    "created_at } }"
)

Q_MARK_MESSAGES_AS_READ = (
    "mutation MarkMessagesAsRead($sender_id: Int!) { markMessagesAsRead(sender_id: $sender_id) }"
)

Q_GET_TOTAL_UNREAD_COUNT = "query GetTotalUnreadCount { getTotalUnreadCount }"

# ---------------------------------------------------------------------------
# Notifications (T1 §3g)
# ---------------------------------------------------------------------------

Q_GET_NOTIFICATIONS = (
    "query NotificationsQuery($data: GetNotificationsInput!) { "
    "getNotifications(data: $data) { id title content url updatedAt createdAt "
    "viewedAt archivedAt } }"
)

Q_MARK_ALL_NOTIFICATIONS_AS_READ = "mutation markAllNotificationsAsRead { markAllNotificationsAsRead }"

Q_MARK_NOTIFICATION_AS_ARCHIVED = (
    "mutation markNotificationAsArchived($id: Int!) { markNotificationAsArchived(id: $id) }"
)

Q_MARK_NOTIFICATION_AS_UNARCHIVED = (
    "mutation markNotificationAsUnarchived($id: Int!) { "
    "markNotificationAsUnarchived(id: $id) }"
)

/** Verbatim GraphQL documents (T1-RESEARCH-FULL.md §3 — AUTHORITATIVE).
 *
 * Every document below is copied text-faithful from the bundle extraction
 * (whitespace is irrelevant: the site itself collapses it before sending).
 * Fragment placeholders {Z}/{d}/... from the T1 report are expanded inline —
 * exactly how the bundle's JS string concatenation builds them. Field sets:
 *
 * - POST_FIELDS        = fragment Z with withUserData=true (isFavorite/isReposted included)
 * - SUBREDDIT_FIELDS   = fragment d with isSubreddit + withUserData (the composition
 *                        live-verified against api.scrolller.com in T4-phase1 smoke)
 * - MINIMAL_SUBREDDIT  = fragment d base fields only (used where the T1 report
 *                        states "d fragment withChildren:false" without other opts)
 * - FOLLOWING_SUBREDDIT_FIELDS = fragment d with withChildren:true, isSubreddit:false (T1 §3d)
 * - COLLECTION_FIELDS  = fragment J with withChildren:true (T1 §3d)
 * - SUBSCRIPTION_FIELDS = fragment _ (T1 §3k)
 *
 * Do NOT invent fields here: introspection is disabled and the server rejects
 * unknown fields (T1 §8.4). Operations without verbatim SDL in the T1 report
 * are intentionally absent (searchCollections, register, renewLoginToken, ...).
 */

/** fragment Z (withUserData defaults true per T1 §3). */
export const POST_FIELDS = `\
__typename
id
url
title
reddit_posted_by
subredditId
subredditTitle
subredditUrl
subredditIsFollowing
redditPath
isNsfw
hasAudio
fullLengthSource
gfycatSource
redgifsSource
ownerAvatar
username
displayName
userType
favoriteCount
repostCount
isPaid
tags
commentsCount
commentsRepliesCount
duration
createdAt
albumContent {
  mediaSources { url width height isOptimized type }
}
isFavorite
isReposted
mediaSources { url width height isOptimized type }
blurredMediaSources { url width height isOptimized type }`;

/** fragment d with isSubreddit + withUserData (no displayMedia). */
export const SUBREDDIT_FIELDS = `\
__typename
id
url
title
secondaryTitle
description
createdAt
isNsfw
subscribers
isComplete
itemCount
videoCount
pictureCount
albumCount
isPaid
username
tags
banner {
  url
  width
  height
  isOptimized
}
isFollowing
moreSubreddits {
  id
  url
  title
  isPaid
  isNsfw
  previewUrl
}`;

/** fragment d base fields only (no isSubreddit/withUserData/withDisplayMedia/withChildren). */
export const MINIMAL_SUBREDDIT_FIELDS = `\
__typename
id
url
title
secondaryTitle
description
createdAt
isNsfw
subscribers
isComplete
itemCount
videoCount
pictureCount
albumCount`;

/** fragment d with withChildren:true, isSubreddit:false (GetFollowingSubreddits composition, T1 §3d). */
export const FOLLOWING_SUBREDDIT_FIELDS = `\
__typename
id
url
title
secondaryTitle
description
createdAt
isNsfw
subscribers
isComplete
itemCount
videoCount
pictureCount
albumCount
children {
  iterator
  items {
    ${POST_FIELDS}
  }
}`;

/** fragment J with withChildren:true (GetFollowingCollections composition, T1 §3d). */
export const COLLECTION_FIELDS = `\
__typename
id
url
title
description
is_private
is_nsfw
is_following
children {
  iterator
  items {
    ${POST_FIELDS}
  }
}`;

/** fragment _ (subscription fields, T1 §3k). */
export const SUBSCRIPTION_FIELDS = `\
id
status
planName
interval
next_recurring
ends_at
product_id
payment_method
price
canManageSubscription`;

// ---------------------------------------------------------------------------
// 3a. Media / feed
// ---------------------------------------------------------------------------

/** DiscoverFilteredSubredditsQuery (T1 §3a; composition live-verified in T4-phase1). */
export const DISCOVER_QUERY = `\
query DiscoverFilteredSubredditsQuery(
  $filter: GalleryFilter
  $sortBy: GallerySortBy
  $limit: Int!
  $childLimit: Int!
  $iterator: String
  $includeFilters: [Int!]
  $excludeFilters: [Int!]
  $nsfw: NsfwFilter
) {
  discoverFilteredSubreddits(data: {
    nsfw: $nsfw
    filter: $filter
    limit: $limit
    childLimit: $childLimit
    iterator: $iterator
    includeFilters: $includeFilters
    excludeFilters: $excludeFilters
    sortBy: $sortBy
  }) {
    iterator
    recommendationType
    hasV1Recommendations
    hasV2Recommendations
    items {
      ${SUBREDDIT_FIELDS}
      children {
        iterator
        items {
          ${POST_FIELDS}
        }
      }
    }
  }
}`;

/** GetAllRecommendationsContent (T1 §3a) — the "More like this" post recommendations. */
export const GET_POST_RECOMMENDATIONS_QUERY = `\
query GetAllRecommendationsContent($postId: Int!) {
  getPostRecommendations(data: {postId: $postId}) {
    subreddits {
      subredditUrl
    }
  }
}`;

/** GetPostsByCreators (T1 §3a; site defaults sortBy RANDOM, limit 50). */
export const GET_POSTS_BY_CREATORS_QUERY = `\
query GetPostsByCreators(
  $iterator: String
  $filter: GalleryFilter
  $sortBy: GallerySortBy
  $limit: Int!
  $nsfw: NsfwFilter
) {
  getPostsByCreators(
    data: {
      limit: $limit
      iterator: $iterator
      filter: $filter
      sortBy: $sortBy
      nsfw: $nsfw
    }
  ) {
    iterator
    items {
      ${POST_FIELDS}
    }
  }
}`;

/** PostsByTag (T1 §3a). $data is the PostsByTagInput object — the T1 report
 * shows the caller spreading {nsfw:"SFW", ...} but does not name the tag field,
 * so the client passes the input through as given. */
export const POSTS_BY_TAG_QUERY = `\
query PostsByTag($data: PostsByTagInput!) {
  getPostsByTag(data: $data) {
    iterator
    items {
      ${POST_FIELDS}
      altText
      description
      tagLinks { label url }
      hiddenTagCount
    }
  }
}`;

/** PostHiddenTags (T1 §3a). */
export const POST_HIDDEN_TAGS_QUERY = `\
query PostHiddenTags($postId: Int!) {
  getPostHiddenTags(postId: $postId) { label url }
}`;

/** ResolveScrolllerLinks (T1 §3a, full literal). */
export const RESOLVE_SCROLLLER_LINKS_QUERY = `\
query ResolveScrolllerLinks($urls: [String!]!) {
  resolveScrolllerLinks(urls: $urls) {
    url
    type
    post {
      id
      url
      title
      subredditId
      subredditUrl
      isPaid
      mediaSources { url width height isOptimized type }
      blurredMediaSources { url width height isOptimized type }
    }
    subreddit {
      id
      url
      title
      isPaid
      isNsfw
      previewUrl
    }
    collection {
      id
      url
      title
      description
      is_nsfw
      item_count
      previewUrl
    }
  }
}`;

// ---------------------------------------------------------------------------
// 3b. Subreddit
// ---------------------------------------------------------------------------

/** SubredditQuery (T1 §3b) — embedded children carry no server-side args. */
export const SUBREDDIT_QUERY = `\
query SubredditQuery(
  $url: String!
  $iterator: String
  $sortBy: GallerySortBy
  $filter: GalleryFilter
  $limit: Int!
) {
  getSubreddit(data: {url: $url, iterator: $iterator, filter: $filter, limit: $limit, sortBy: $sortBy}) {
    ${SUBREDDIT_FIELDS}
    children {
      iterator
      items {
        ${POST_FIELDS}
      }
    }
  }
}`;

/** SubredditChildrenQuery (T1 §3b) — infinite-scroll continuation. */
export const SUBREDDIT_CHILDREN_QUERY = `\
query SubredditChildrenQuery(
  $subredditId: Int!
  $iterator: String
  $filter: GalleryFilter
  $sortBy: GallerySortBy
  $limit: Int!
  $nsfw: NsfwFilter
) {
  getSubredditChildren(
    data: {
      subredditId: $subredditId,
      iterator: $iterator,
      filter: $filter,
      sortBy: $sortBy,
      limit: $limit,
      nsfw: $nsfw
    },
  ) {
    iterator
    items {
      ${POST_FIELDS}
    }
  }
}`;

/** SubredditPostQuery (T1 §3b, withParent=true composition: full Z + extras). */
export const SUBREDDIT_POST_QUERY = `\
query SubredditPostQuery(
  $url: String!
) {
  getPost(data: { url: $url }) {
    ${POST_FIELDS}
    altText
    description
    tagLinks { label url }
    hiddenTagCount
  }
}`;

/** SearchSubredditsQuery (T1 §3b). */
export const SEARCH_SUBREDDITS_QUERY = `\
query SearchSubredditsQuery($query: String!, $limit: Int!, $isNsfw: Boolean!, $pageIndex: Int!) {
  searchSubreddits(
  data: {
    query: $query
    isNsfw: $isNsfw
    limit: $limit
    pageIndex: $pageIndex
  }
  ) {
    id
    title
    url
    secondary_title
    description
    is_nsfw
    item_count
    preview_images {
      url
      width
      height
    }
  }
}`;

/** SearchSubredditWithPreview (T1 §3b). */
export const SEARCH_SUBREDDIT_WITH_PREVIEW_QUERY = `\
query SearchSubredditWithPreview($query: String!, $limit: Int!, $pageIndex: Int!) {
  searchSubredditWithPreview(
    data: {
      query: $query
      limit: $limit
      pageIndex: $pageIndex
    }
  ) {
    title
    secondaryTitle
    url
    isNsfw
    itemCount
    previewImage {
      url
      width
      height
    }
  }
}`;

/** getCategories (T1 §3b, full literal). */
export const GET_CATEGORIES_QUERY = `\
query getCategories(
  $sort: String,
  $nsfw: Boolean!,
) {
  categories(
  data: {
    order_by: $sort,
    is_nsfw: $nsfw,
  }
) {
  title
  elements {
   title
   elements {
    title
    elements {
      title
      elements {
        title
      }
    }
   }
  }
} }`;

// ---------------------------------------------------------------------------
// 3c. Collections
// ---------------------------------------------------------------------------

/** GetUserCollectionsQuery (T1 §3c). */
export const GET_USER_COLLECTIONS_QUERY = `\
query GetUserCollectionsQuery {
  getUserCollections {
    id
    title
    url
    is_nsfw
    is_private
    description
    posts {
      id
    }
  }
}`;

/** GetUserCollectionQuery (T1 §3c). */
export const GET_USER_COLLECTION_QUERY = `\
query GetUserCollectionQuery(
  $url: String!
) {
  getUserCollection(
    url: $url
  ) {
    id
    tag
    title
    url
    description
    is_private
    is_nsfw
    user_account_id
    is_following
    item_count
  }
}`;

/** GetCollectionById (T1 §3c). */
export const GET_COLLECTION_BY_ID_QUERY = `\
query GetCollectionById($collectionId: Int!) {
  getCollection(id: $collectionId) {
    id
    title
    url
    description
    is_private
    is_nsfw
    user_account_id
    item_count
    is_following
  }
}`;

/** getUserCollectionContentQuery (T1 §3c). */
export const GET_USER_COLLECTION_CONTENT_QUERY = `\
query getUserCollectionContentQuery(
  $iterator: String
  $nsfw: NsfwFilter
  $filter: GalleryFilter
  $sortBy: GallerySortBy
  $limit: Int!
  $collectionId: Int!
  ) {
  getUserCollectionContent(
    data: {
      nsfw: $nsfw
      limit: $limit
      sortBy: $sortBy
      filter: $filter
      iterator: $iterator
      collectionId: $collectionId
    }
  ) {
    iterator
    items {
      ${POST_FIELDS}
    }
  }
}`;

/** CreateCollection (T1 §3c). */
export const CREATE_COLLECTION_MUTATION = `\
mutation CreateCollection(
  $title: String!,
  $description: String,
  $is_private: Boolean!
  $is_nsfw: Boolean!
) {
  createCollection(data: {
    title: $title,
    description: $description,
    is_private: $is_private,
    is_nsfw: $is_nsfw,
  }) {
    id
    title
    description
    url
    is_private
    is_nsfw
  }
}`;

/** EditCollection (T1 §3c). */
export const EDIT_COLLECTION_MUTATION = `\
mutation EditCollection(
  $id: Int!,
  $title: String!,
  $description: String,
  $is_private: Boolean!
  $is_nsfw: Boolean!
) {
  editCollection(data: {
    id: $id,
    title: $title,
    description: $description,
    is_private: $is_private,
    is_nsfw: $is_nsfw,
  }) {
    id
    title
    description
    url
    is_private
    is_nsfw
  }
}`;

/** DeleteCollection (T1 §3c). */
export const DELETE_COLLECTION_MUTATION = `\
mutation DeleteCollection(
  $id: Int!,
) {
  deleteCollection(data: {
    id: $id,
  })
}`;

/** AddPostToCollection / RemovePostFromCollection (T1 §3c). */
export const ADD_POST_TO_COLLECTION_MUTATION = `\
mutation AddPostToCollection($postId: Int!, $collectionId: Int!) {
  addPostToCollection(data: { postId: $postId, collectionId: $collectionId })
}`;

export const REMOVE_POST_FROM_COLLECTION_MUTATION = `\
mutation RemovePostFromCollection($postId: Int!, $collectionId: Int!) {
  removePostFromCollection(data: { postId: $postId, collectionId: $collectionId })
}`;

/** PaidCollections (T1 §3c) — `isNsfw` and `limit` are interpolated literals in
 * the bundle; this factory replicates that (both values are caller-supplied
 * booleans/numbers, never raw strings, so interpolation is safe). Items use the
 * minimal d-fragment composition (see MINIMAL_SUBREDDIT_FIELDS). */
export function paidCollectionsQuery(isNsfw: boolean, limit: number): string {
  return `\
query PaidCollections(
  $iterator: String
) {
  getMyPaidCollections(
    isNsfw: ${isNsfw ? "true" : "false"}
    limit: ${Math.trunc(limit)}
    iterator: $iterator
  ) {
    iterator
    items {
      ${MINIMAL_SUBREDDIT_FIELDS}
    }
  }
}`;
}

/** getCollectionSetup (T1 §3c, full literal). */
export const GET_COLLECTION_SETUP_QUERY = `\
query getCollectionSetup ($collectionId:Int!) {
  getCollectionSetup(collectionId:$collectionId){
    collection{
      id
      title
      description
      secondary_title
      is_paid
      user_account_id
      item_count
      video_count
      picture_count
      subscribers
    }
    offer{
      amount
      product_id
      campaign_id
      is_active
      type
      billing_model_id
    }
    owner{
      username
      avatar
      displayName
    }
    hasAccess
    status
  }
}`;

// ---------------------------------------------------------------------------
// 3d. Users / follow
// ---------------------------------------------------------------------------

/** LoginQuery (T1 §2). */
export const LOGIN_QUERY = `\
query LoginQuery($username: String!, $password: String!) {
  login(username: $username, password: $password) {
    username
    token
    expiresAt
    isAdmin
    deleted_at
    isPremium
  }
}`;

/** GetLoggedInUserQuery (T1 §3d, full literal). */
export const GET_LOGGED_IN_USER_QUERY = `\
query GetLoggedInUserQuery {
  getLoggedInUser {
    id
    username
    email
    premium_ends
    created_at
    email_verified_at
    age_verified_at
    phone_verified_at
    last_active_at
    isPremium
    socialType
    deleted_at
    hasLeaderboardEntry
    cta_closed_at
    leaderboard_visited_at
    settings{
      id
      video_autoplay
      send_sfw
      send_nsfw
      preference
      nsfw_preference
      soft_delete
      send_comment_emails
      send_message_emails
      send_newsletter
      track_watch_history
    }
    first_name
    last_name
    phone_number
    bio
    birthday
    display_name
    location
    banner_image
    avatar
    wishlist
    video_intro
    social_media {
      instagram
      twitter
      tiktok
      snapchat
      personal_website
    }
  }
}`;

/** UpdateUser (T1 §3d). */
export const UPDATE_USER_MUTATION = `\
mutation UpdateUser($email: String, $username: String, $first_name: String, $last_name: String, $display_name: String, $location: String, $birthday: String, $bio: String) {
  updateUser(
    data: {
      email: $email,
      username: $username,
      first_name: $first_name,
      last_name: $last_name,
      display_name: $display_name,
      location: $location,
      birthday: $birthday,
      bio: $bio
    }
  )
}`;

/** updateInfo (T1 §3m). */
export const UPDATE_INFO_MUTATION = `\
mutation updateInfo {
    updateInfo
  }`;

/** MarkPostWithSound → addWithSound (T1 §3h). */
export const MARK_POST_WITH_SOUND_MUTATION = `\
mutation MarkPostWithSound($postId: Int!, $hasAudio: Boolean!) {
  addWithSound(postId: $postId, hasAudio: $hasAudio)
}`;

/** Follow / unfollow (T1 §3d) — both documents are literally named `Follow` in
 * the bundles; the field call differs. Keep both texts verbatim. */
export const FOLLOW_MUTATION = `\
mutation Follow($url: String!) {
  follow(url: $url)
}`;

export const UNFOLLOW_MUTATION = `\
mutation Follow($url: String!) {
  unfollow(url: $url)
}`;

/** GetIsFollowingSubreddit / GetIsFollowingUser / GetIsFollowingUserCollection (T1 §3d). */
export const GET_IS_FOLLOWING_SUBREDDIT_QUERY = `\
query GetIsFollowingSubreddit($ids: [Int!]!) {
  getIsFollowingSubreddit(ids: $ids) {
    id
    isFollowing
  }
}`;

export const GET_IS_FOLLOWING_USER_QUERY = `\
query GetIsFollowingUser($id: Int, $username: String) {
  getIsFollowingUser(id: $id, username: $username) {
    isFollowing
  }
}`;

export const GET_IS_FOLLOWING_USER_COLLECTION_QUERY = `\
query GetIsFollowingUserCollection($id: Int!) {
  getIsFollowingUserCollection(id: $id)
}`;

/** GetAllFollowingContent (T1 §3d). */
export const GET_ALL_FOLLOWING_CONTENT_QUERY = `\
query GetAllFollowingContent {
  getAllFollowingContent {
    subreddits {
      subredditUrl
    }
    collections {
      collectionUrl
    }
  }
}`;

/** GetFollowingSubreddits (T1 §3d — d fragment withChildren:true, isSubreddit:false). */
export const GET_FOLLOWING_SUBREDDITS_QUERY = `\
query GetFollowingSubreddits ($iterator: String, $limit: Int!, $filter: GalleryFilter, $nsfw: NsfwFilter, $sortBy: GallerySortBy) {
  getFollowingSubreddits(
    data: {
      nsfw: $nsfw
      limit: $limit
      filter: $filter
      iterator: $iterator
      sortBy: $sortBy
    }
  ) {
    iterator
    items {
      ${FOLLOWING_SUBREDDIT_FIELDS}
    }
  }
}`;

/** GetFollowingCollections (T1 §3d — J fragment withChildren:true). */
export const GET_FOLLOWING_COLLECTIONS_QUERY = `\
query GetFollowingCollections ($iterator: String, $filter: GalleryFilter, $sortBy: GallerySortBy, $limit: Int!, $nsfw: NsfwFilter) {
  getFollowingCollections(
    data: {
      nsfw: $nsfw
      limit: $limit
      iterator: $iterator
      filter: $filter
      sortBy: $sortBy
    }
  ) {
    iterator
    items {
      ${COLLECTION_FIELDS}
    }
  }
}`;

/** UserPostsQuery (T1 §3d; site default sortBy RANDOM). */
export const USER_POSTS_QUERY = `\
query UserPostsQuery(
  $username: String!
  $iterator: String
  $limit: Int!
  $filter: GalleryFilter
  $sortBy: GallerySortBy
  $nsfw: NsfwFilter
) {
  getUserPosts(
    data: {
      username: $username
      iterator: $iterator
      limit: $limit
      filter: $filter
      sortBy: $sortBy
      nsfw: $nsfw
    }
  ) {
    iterator
    items {
      ${POST_FIELDS}
    }
  }
}`;

/** RedditUserPostsQuery (T1 §3d; site default sortBy RANDOM). */
export const REDDIT_USER_POSTS_QUERY = `\
query RedditUserPostsQuery(
  $username: String!
  $iterator: String
  $limit: Int!
  $filter: GalleryFilter
  $sortBy: GallerySortBy
  $nsfw: NsfwFilter
) {
  getRedditUserPosts(
    data: {
      username: $username
      iterator: $iterator
      limit: $limit
      filter: $filter
      sortBy: $sortBy
      nsfw: $nsfw
    }
  ) {
    iterator
    items {
      ${POST_FIELDS}
    }
  }
}`;

/** SearchUsersQuery (T1 §3d). */
export const SEARCH_USERS_QUERY = `\
query SearchUsersQuery($query: String!, $limit: Int!, $pageIndex: Int!) {
  searchUsers(
    data: {
      query: $query
      limit: $limit
      pageIndex: $pageIndex
    }
  ) {
    id
    username
    description
    avatar
    isFollowing
    isCurrentUser
    displayName
  }
}`;

// ---------------------------------------------------------------------------
// 3e. Comments (Scrolller-side)
// ---------------------------------------------------------------------------

/** getCommentsQuery (T1 §3e) — returns a PLAIN ARRAY of comments. */
export const GET_COMMENTS_QUERY = `\
query getCommentsQuery($post_id: Int!, $pagination: CommentPaginationInput!) {
  getComments(
    data: {
      post_id: $post_id
      pagination: $pagination
    }
  ) {
     id
      content
      likes_count
      created_at
      updated_at
      deleted_at
      user_account {
        id
        username
        avatar
        is_premium
      }
      replies_count
      is_liked
  }
}`;

/** getRepliesFromCommentQuery (T1 §3e) — returns a PLAIN ARRAY of replies. */
export const GET_REPLIES_FROM_COMMENT_QUERY = `\
query getRepliesFromCommentQuery($comment_id: Int!, $pagination: CommentPaginationInput!) {
  getRepliesFromComment(
    data: {
      comment_id: $comment_id
      pagination: $pagination
    }
  ) {
      id
      content
      likes_count
      created_at
      updated_at
      deleted_at
      user_account {
        id
        username
        avatar
        is_premium
      }
      replies_count
      is_liked
    }
}`;

/** Comment write mutations (T1 §3e). */
export const CREATE_COMMENT_MUTATION = `\
mutation createComment($content: String!, $post_id: Int!) {
  createComment(data: {content: $content, post_id: $post_id}) {
    id
    postCommentsCount
    postCommentsRepliesCount
  }
}`;

export const CREATE_COMMENT_REPLY_MUTATION = `\
mutation createCommentReply($content: String!, $parent_comment_id: Int!) {
  createCommentReply(data: {content: $content, parent_comment_id: $parent_comment_id}) {
    id
    postCommentsCount
    postCommentsRepliesCount
  }
}`;

export const LIKE_COMMENT_MUTATION = `\
mutation likeComment($id: Int!) {
  likeComment(id: $id)
}`;

export const UNLIKE_COMMENT_MUTATION = `\
mutation unlikeComment($id: Int!) {
  unlikeComment(id: $id)
}`;

export const DELETE_COMMENT_MUTATION = `\
mutation deleteComment($id: Int!) {
  deleteComment(id: $id) {
    id
    postCommentsCount
    postCommentsRepliesCount
  }
}`;

export const REPORT_COMMENT_MUTATION = `\
mutation reportComment($commentId: Int!, $reason: String!, $details: String) {
  reportComment(data: {commentId: $commentId, reason: $reason, details: $details})
}`;

// ---------------------------------------------------------------------------
// 3f. Messages / chat
// ---------------------------------------------------------------------------

/** Message fields fragment (T1 §3f, module 957931). */
export const MESSAGE_FIELDS = `\
id
content
sender_id
receiver_id
sender {
  id
  username
  avatar
  is_reddit_account
}
read_at
created_at`;

/** GetMessages (T1 §3f; caller variables {data: {other_user_id, limit, page}}). */
export const GET_MESSAGES_QUERY = `\
query GetMessages($data: GetMessagesInput!) {
  getMessages(data: $data) {
    items {
      ${MESSAGE_FIELDS}
    }
    total
  }
}`;

/** GetConversations (T1 §3f; caller variables {data: {limit: 20, cursor?}}). */
export const GET_CONVERSATIONS_QUERY = `\
query GetConversations($data: GetConversationsInput!) {
  getConversations(data: $data) {
    items {
      user {
        id
        username
        avatar
        is_reddit_account
      }
      last_message {
        ${MESSAGE_FIELDS}
      }
      unread_count
    }
    next_cursor
  }
}`;

/** SendMessage (T1 §3f; caller variables {data: {receiver_id, content}}). */
export const SEND_MESSAGE_MUTATION = `\
mutation SendMessage($data: SendMessageInput!) {
  sendMessage(data: $data) {
    id
    content
    sender_id
    receiver_id
    sender {
      id
      username
      avatar
    }
    read_at
    created_at
  }
}`;

/** MarkMessagesAsRead (T1 §3f). */
export const MARK_MESSAGES_AS_READ_MUTATION = `\
mutation MarkMessagesAsRead($sender_id: Int!) {
  markMessagesAsRead(sender_id: $sender_id)
}`;

/** GetTotalUnreadCount (T1 §3f). */
export const GET_TOTAL_UNREAD_COUNT_QUERY = `\
query GetTotalUnreadCount {
  getTotalUnreadCount
}`;

// ---------------------------------------------------------------------------
// 3g. Notifications
// ---------------------------------------------------------------------------

/** NotificationsQuery (T1 §3g; caller passes {pagination:{page:1, limit:30}}). */
export const NOTIFICATIONS_QUERY = `\
query NotificationsQuery($data: GetNotificationsInput!) {
  getNotifications(data: $data) {
    id
    title
    content
    url
    updatedAt
    createdAt
    viewedAt
    archivedAt
  }
}`;

/** Notification mark mutations (T1 §3g). */
export const MARK_ALL_NOTIFICATIONS_AS_READ_MUTATION = `\
mutation markAllNotificationsAsRead {
  markAllNotificationsAsRead
}`;

export const MARK_NOTIFICATION_AS_ARCHIVED_MUTATION = `\
mutation markNotificationAsArchived($id: Int!) {
  markNotificationAsArchived(id: $id)
}`;

export const MARK_NOTIFICATION_AS_UNARCHIVED_MUTATION = `\
mutation markNotificationAsUnarchived($id: Int!) {
  markNotificationAsUnarchived(id: $id)
}`;

// ---------------------------------------------------------------------------
// 3h. Favorites / reposts
// ---------------------------------------------------------------------------

/** Favorites/reposts (T1 §3h). */
export const ADD_FAVORITE_MUTATION = `\
mutation AddFavorite($url: String!) {
  addFavorite(url: $url)
}`;

export const REMOVE_FAVORITE_MUTATION = `\
mutation RemoveFavorite($url: String!) {
  removeFavorite(url: $url)
}`;

export const GET_POST_IS_FAVORITE_QUERY = `\
query GetPostIsFavorite($url: String!) {
  getPostIsFavorite(url: $url)
}`;

export const REPOST_POST_MUTATION = `\
mutation RepostPost($url: String!) {
  repostPost(url: $url)
}`;

export const REMOVE_REPOST_MUTATION = `\
mutation RemoveRepost($url: String!) {
  removeRepost(url: $url)
}`;

// ---------------------------------------------------------------------------
// 3i. Hide rules
// ---------------------------------------------------------------------------

/** HideContent / UnhideContent / rules (T1 §3i; contentType enum POST | SUBREDDIT). */
export const HIDE_CONTENT_MUTATION = `\
mutation HideContent($data: HideContentInput!) {
  hideContent(data: $data) {
    rule {
      id
      contentType
      targetId
      createdAt
    }
  }
}`;

export const UNHIDE_CONTENT_MUTATION = `\
mutation UnhideContent($data: UnhideContentInput!) {
  unhideContent(data: $data)
}`;

export const GET_USER_HIDE_CONTENT_RULES_QUERY = `\
query GetUserHideContentRules {
  getUserHideContentRules {
    id
    contentType
    targetId
    createdAt
  }
}`;

export const GET_USER_HIDE_CONTENT_RULES_WITH_URL_QUERY = `\
query GetUserHideContentRulesWithUrl {
  getUserHideContentRulesWithUrl {
    id
    contentType
    targetId
    createdAt
    url
    subredditTitle
    isNsfw
  }
}`;

// ---------------------------------------------------------------------------
// 3j. Reports
// ---------------------------------------------------------------------------

/** Report mutations (T1 §3j). */
export const REPORT_POST_MUTATION = `\
mutation ReportPost($postId: Int!, $reason: String!, $details: String) {
  reportPost(data: { postId: $postId, reason: $reason, details: $details })
}`;

export const REPORT_COLLECTION_MUTATION = `\
mutation ReportCollection($collectionId: Int!, $reason: String!, $details: String) {
  reportCollection(data: { collectionId: $collectionId, reason: $reason, details: $details })
}`;

export const REPORT_USER_MUTATION = `\
mutation ReportUser($userId: Int!, $reason: String!, $details: String) {
  reportUser(data: { userId: $userId, reason: $reason, details: $details })
}`;

// ---------------------------------------------------------------------------
// 3k. Paid / subscriptions
// ---------------------------------------------------------------------------

/** PlanQuery (T1 §3k) — live-verified anonymous (T1 §2). */
export const PLAN_QUERY = `\
query PlanQuery {
  subscription_plans(orderBy:{id:asc}) {
      id
      offer_id
      product_id
      name
      billing_model_id
      interval
      amount
    }
}`;

/** Account (T1 §3k). */
export const ACCOUNT_QUERY = `\
query Account {
    myAccount{
      card_last4
      card_type
      card_exp_month
      card_exp_year
    }
}`;

/** Subscription (T1 §3k, fragment _ + collectionSubscriptions). */
export const SUBSCRIPTION_QUERY = `\
query Subscription {
    mySubscription{
      ${SUBSCRIPTION_FIELDS}
      collectionSubscriptions {
        ${SUBSCRIPTION_FIELDS}
        creatorName
      }
    }
}`;

// ---------------------------------------------------------------------------
// 3l. Creator payouts & uploads
// ---------------------------------------------------------------------------

/** getRevShare / getCreatorReport (T1 §3l). */
export const GET_REV_SHARE_QUERY = `\
query getRevShare{
  revShare
}`;

export const GET_CREATOR_REPORT_QUERY = `\
query getCreatorReport {
  getCreatorReport{
      revenueByDay{ amount day }
      revenueTotal
      revenueAvailable
      subscribersByDay{ amount day }
      subscribersTotal
      impressionsTotal
      impressionsByDay{ day amount }
      collectionImpressionsTotal
      collectionImpressionsByDay{ day amount }
      checkoutImpressionsTotal
      checkoutImpressionsByDay{ day amount }
    }
}`;

/** addCreatorPost → uploadPostToSubreddit (T1 §3l). */
export const ADD_CREATOR_POST_MUTATION = `\
mutation addCreatorPost($title: String!, $keywords: String!, $isNsfw: Boolean!, $mediaUrl: String!, $subredditUrl: String!, $sourceSetId: Int!, $setHeader: Boolean!, $mediaType: String!) {
  uploadPostToSubreddit(data: { title: $title, keywords: $keywords, isNsfw: $isNsfw, mediaUrl: $mediaUrl, subredditUrl: $subredditUrl, sourceSetId: $sourceSetId, setHeader: $setHeader, mediaType: $mediaType }) {
    title
    url
  }
}`;

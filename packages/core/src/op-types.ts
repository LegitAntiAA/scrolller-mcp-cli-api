/** Types for the operation methods (CONTRACT.md §6; field sets mirror the
 * verbatim SDL selections in queries.ts). Everything is deliberately loose —
 * fields the API may omit are optional/nullable; ids arrive as numbers but are
 * not guaranteed on every object shape.
 */
import type { GalleryFilter, GallerySortBy, MediaSource, NsfwFilter } from "./types.js";

// ---------------------------------------------------------------------------
// Enums (bundle-verified, CONTRACT.md §1)
// ---------------------------------------------------------------------------

export type { GalleryFilter, GallerySortBy, NsfwFilter };

export const GALLERY_SORT_BYS = ["RANDOM", "TOP", "HOT", "NEW", "CONTROVERSIAL"] as const;
export const GALLERY_FILTERS = ["CATEGORY", "SUBREDDIT", "ALBUM", "VIDEO", "PICTURE", "SOUND"] as const;

// ---------------------------------------------------------------------------
// Shared page shapes
// ---------------------------------------------------------------------------

/** One iterator-paginated page. `iterator` is the opaque server cursor — pass
 * it back byte-exact (CONTRACT.md §1); null/""/"null" means exhausted. */
export interface FeedPage<T> {
  iterator: string | null;
  items: T[];
}

// ---------------------------------------------------------------------------
// Posts (fragment Z + SubredditPostQuery extras)
// ---------------------------------------------------------------------------

export interface TagLink {
  label?: string | null;
  url?: string | null;
}

/** Post object as returned by the API selections (fragment Z + extras).
 * Declared as a type ALIAS (not an interface) so PostResult carries an implicit
 * index signature and is directly assignable to the download helpers' PostLike
 * (CONTRACT.md §7 accepts post objects). */
export type PostResult = {
  __typename?: string | null;
  id?: number | string | null;
  url?: string | null;
  title?: string | null;
  reddit_posted_by?: string | null;
  subredditId?: number | string | null;
  subredditTitle?: string | null;
  subredditUrl?: string | null;
  subredditIsFollowing?: boolean | null;
  redditPath?: string | null;
  isNsfw?: boolean | null;
  hasAudio?: boolean | null;
  /** Reference PAGE URL (gfycat/redgifs web page) — never a media file (BUG-1). */
  fullLengthSource?: string | null;
  /** Reference PAGE URL — never a media file (BUG-1). */
  gfycatSource?: string | null;
  /** Reference PAGE URL — never a media file (BUG-1). */
  redgifsSource?: string | null;
  ownerAvatar?: string | null;
  username?: string | null;
  displayName?: string | null;
  userType?: string | null;
  favoriteCount?: number | null;
  repostCount?: number | null;
  isPaid?: boolean | null;
  tags?: string[] | null;
  commentsCount?: number | null;
  commentsRepliesCount?: number | null;
  duration?: string | null;
  createdAt?: string | null;
  albumContent?: { mediaSources?: MediaSource[] | null } | null;
  isFavorite?: boolean | null;
  isReposted?: boolean | null;
  /** Download URLs come ONLY from here (CONTRACT.md §7). */
  mediaSources?: MediaSource[] | null;
  blurredMediaSources?: MediaSource[] | null;
  /** Only on SubredditPostQuery / PostsByTag selections. */
  altText?: string | null;
  description?: string | null;
  tagLinks?: TagLink[] | null;
  hiddenTagCount?: number | null;
}

/** Post items of PostsByTag (Z + altText/description/tagLinks/hiddenTagCount). */
export type PostWithTagResult = PostResult;

// ---------------------------------------------------------------------------
// Subreddits (fragment d variants + search shapes)
// ---------------------------------------------------------------------------

export interface SubredditChildren {
  iterator?: string | null;
  items?: PostResult[] | null;
}

export interface SubredditResult {
  __typename?: string | null;
  id?: number | string | null;
  url?: string | null;
  title?: string | null;
  secondaryTitle?: string | null;
  description?: string | null;
  createdAt?: string | null;
  isNsfw?: boolean | null;
  subscribers?: number | null;
  isComplete?: boolean | null;
  itemCount?: number | null;
  videoCount?: number | null;
  pictureCount?: number | null;
  albumCount?: number | null;
  isPaid?: boolean | null;
  username?: string | null;
  tags?: string[] | null;
  banner?: MediaSource | null;
  isFollowing?: boolean | null;
  moreSubreddits?: Array<{
    id?: number | string | null;
    url?: string | null;
    title?: string | null;
    isPaid?: boolean | null;
    isNsfw?: boolean | null;
    previewUrl?: string | null;
  }> | null;
  children?: SubredditChildren | null;
}

/** DiscoverFilteredSubredditsQuery response page. */
export interface DiscoverResult extends FeedPage<SubredditResult> {
  recommendationType?: string | null;
  hasV1Recommendations?: boolean | null;
  hasV2Recommendations?: boolean | null;
}

/** First page of a subreddit feed (getSubreddit + its embedded children). */
export interface SubredditFeedPage extends FeedPage<PostResult> {
  subreddit?: SubredditResult | null;
}

/** searchSubreddits result (snake_case fields per SDL). */
export interface SearchSubredditResult {
  id?: number | string | null;
  title?: string | null;
  url?: string | null;
  secondary_title?: string | null;
  description?: string | null;
  is_nsfw?: boolean | null;
  item_count?: number | null;
  preview_images?: Array<{ url?: string | null; width?: number | null; height?: number | null }> | null;
}

/** searchSubredditWithPreview result (camelCase fields per SDL). */
export interface SearchSubredditPreviewResult {
  title?: string | null;
  secondaryTitle?: string | null;
  url?: string | null;
  isNsfw?: boolean | null;
  itemCount?: number | null;
  previewImage?: { url?: string | null; width?: number | null; height?: number | null } | null;
}

/** searchUsers result. */
export interface SearchUserResult {
  id?: number | string | null;
  username?: string | null;
  description?: string | null;
  avatar?: string | null;
  isFollowing?: boolean | null;
  isCurrentUser?: boolean | null;
  displayName?: string | null;
}

/** getCategories result (4-level nested tree). */
export interface CategoryNode {
  title?: string | null;
  elements?: CategoryNode[] | null;
}

// ---------------------------------------------------------------------------
// Collections (J / GetUserCollection / GetCollectionById shapes — loose union)
// ---------------------------------------------------------------------------

export interface CollectionResult {
  __typename?: string | null;
  id?: number | string | null;
  tag?: string | null;
  title?: string | null;
  url?: string | null;
  description?: string | null;
  is_private?: boolean | null;
  is_nsfw?: boolean | null;
  is_following?: boolean | null;
  user_account_id?: number | string | null;
  item_count?: number | null;
  previewUrl?: string | null;
  posts?: Array<{ id?: number | string | null }> | null;
  children?: SubredditChildren | null;
}

/** getCollectionSetup result. */
export interface CollectionSetupResult {
  collection?: {
    id?: number | string | null;
    title?: string | null;
    description?: string | null;
    secondary_title?: string | null;
    is_paid?: boolean | null;
    user_account_id?: number | string | null;
    item_count?: number | null;
    video_count?: number | null;
    picture_count?: number | null;
    subscribers?: number | null;
  } | null;
  offer?: {
    amount?: number | null;
    product_id?: number | string | null;
    campaign_id?: number | string | null;
    is_active?: boolean | null;
    type?: string | null;
    billing_model_id?: number | string | null;
  } | null;
  owner?: { username?: string | null; avatar?: string | null; displayName?: string | null } | null;
  hasAccess?: boolean | null;
  status?: string | null;
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export interface CommentAuthor {
  id?: number | string | null;
  username?: string | null;
  avatar?: string | null;
  is_premium?: boolean | null;
}

export interface CommentResult {
  id?: number | string | null;
  content?: string | null;
  likes_count?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
  user_account?: CommentAuthor | null;
  replies_count?: number | null;
  is_liked?: boolean | null;
}

export interface CommentWriteResult {
  id?: number | string | null;
  postCommentsCount?: number | null;
  postCommentsRepliesCount?: number | null;
}

// ---------------------------------------------------------------------------
// Messages / notifications
// ---------------------------------------------------------------------------

export interface MessageAuthor {
  id?: number | string | null;
  username?: string | null;
  avatar?: string | null;
  is_reddit_account?: boolean | null;
}

export interface MessageResult {
  id?: number | string | null;
  content?: string | null;
  sender_id?: number | string | null;
  receiver_id?: number | string | null;
  sender?: MessageAuthor | null;
  read_at?: string | null;
  created_at?: string | null;
}

export interface ConversationResult {
  user?: MessageAuthor | null;
  last_message?: MessageResult | null;
  unread_count?: number | null;
}

export interface ConversationsPage {
  items?: ConversationResult[] | null;
  next_cursor?: string | null;
}

export interface MessagesPage {
  items?: MessageResult[] | null;
  total?: number | null;
}

export interface NotificationResult {
  id?: number | string | null;
  title?: string | null;
  content?: string | null;
  url?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
  viewedAt?: string | null;
  archivedAt?: string | null;
}

// ---------------------------------------------------------------------------
// Account / subscription / creator
// ---------------------------------------------------------------------------

export interface LoginResult {
  username?: string | null;
  token?: string | null;
  expiresAt?: number | null;
  isAdmin?: boolean | null;
  deleted_at?: string | null;
  isPremium?: boolean | null;
}

export interface LoggedInUserResult {
  id?: number | string | null;
  username?: string | null;
  email?: string | null;
  premium_ends?: string | null;
  created_at?: string | null;
  email_verified_at?: string | null;
  age_verified_at?: string | null;
  phone_verified_at?: string | null;
  last_active_at?: string | null;
  isPremium?: boolean | null;
  socialType?: string | null;
  deleted_at?: string | null;
  hasLeaderboardEntry?: boolean | null;
  cta_closed_at?: string | null;
  leaderboard_visited_at?: string | null;
  settings?: {
    id?: number | string | null;
    video_autoplay?: boolean | null;
    send_sfw?: boolean | null;
    send_nsfw?: boolean | null;
    preference?: string | null;
    nsfw_preference?: string | null;
    soft_delete?: boolean | null;
    send_comment_emails?: boolean | null;
    send_message_emails?: boolean | null;
    send_newsletter?: boolean | null;
    track_watch_history?: boolean | null;
  } | null;
  first_name?: string | null;
  last_name?: string | null;
  phone_number?: string | null;
  bio?: string | null;
  birthday?: string | null;
  display_name?: string | null;
  location?: string | null;
  banner_image?: string | null;
  avatar?: string | null;
  wishlist?: string | null;
  video_intro?: string | null;
  social_media?: {
    instagram?: string | null;
    twitter?: string | null;
    tiktok?: string | null;
    snapchat?: string | null;
    personal_website?: string | null;
  } | null;
}

export interface UpdateUserInput {
  email?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  display_name?: string;
  location?: string;
  birthday?: string;
  bio?: string;
}

export interface PlanResult {
  id?: number | string | null;
  offer_id?: number | string | null;
  product_id?: number | string | null;
  name?: string | null;
  billing_model_id?: number | string | null;
  interval?: string | null;
  amount?: number | null;
}

export interface AccountResult {
  card_last4?: string | null;
  card_type?: string | null;
  card_exp_month?: number | null;
  card_exp_year?: number | null;
}

export interface SubscriptionResult {
  id?: number | string | null;
  status?: string | null;
  planName?: string | null;
  interval?: string | null;
  next_recurring?: string | null;
  ends_at?: string | null;
  product_id?: number | string | null;
  payment_method?: string | null;
  price?: number | null;
  canManageSubscription?: boolean | null;
  collectionSubscriptions?: Array<SubscriptionResult & { creatorName?: string | null }> | null;
}

export interface CreatorReportResult {
  revenueByDay?: Array<{ amount?: number | null; day?: string | null }> | null;
  revenueTotal?: number | null;
  revenueAvailable?: number | null;
  subscribersByDay?: Array<{ amount?: number | null; day?: string | null }> | null;
  subscribersTotal?: number | null;
  impressionsTotal?: number | null;
  impressionsByDay?: Array<{ day?: string | null; amount?: number | null }> | null;
  collectionImpressionsTotal?: number | null;
  collectionImpressionsByDay?: Array<{ day?: string | null; amount?: number | null }> | null;
  checkoutImpressionsTotal?: number | null;
  checkoutImpressionsByDay?: Array<{ day?: string | null; amount?: number | null }> | null;
}

export interface CreatorPostInput {
  title: string;
  keywords: string;
  isNsfw: boolean;
  mediaUrl: string;
  subredditUrl: string;
  sourceSetId: number;
  setHeader: boolean;
  mediaType: string;
}

export interface CreatorPostResult {
  title?: string | null;
  url?: string | null;
}

/** host8.scrolller.com/upload response. */
export interface UploadResult {
  url?: string | null;
  sourceSetId?: number | null;
}

/** Local file to upload: either a path or raw bytes with a name. */
export interface UploadSource {
  path?: string;
  data?: Uint8Array;
  fileName?: string;
}

// ---------------------------------------------------------------------------
// Social / hide / reports / resolve
// ---------------------------------------------------------------------------

export interface IsFollowingEntry {
  id?: number | string | null;
  isFollowing?: boolean | null;
}

export interface AllFollowingContent {
  subreddits?: Array<{ subredditUrl?: string | null }> | null;
  collections?: Array<{ collectionUrl?: string | null }> | null;
}

export type HideContentType = "POST" | "SUBREDDIT";

export interface HideContentInput {
  contentType: HideContentType;
  targetId: number;
}

export interface HideRuleResult {
  id?: number | string | null;
  contentType?: HideContentType | string | null;
  targetId?: number | string | null;
  createdAt?: string | null;
}

export interface HideRuleWithUrlResult extends HideRuleResult {
  url?: string | null;
  subredditTitle?: string | null;
  isNsfw?: boolean | null;
}

export interface ResolvedLinkResult {
  url?: string | null;
  type?: string | null;
  post?: {
    id?: number | string | null;
    url?: string | null;
    title?: string | null;
    subredditId?: number | string | null;
    subredditUrl?: string | null;
    isPaid?: boolean | null;
    mediaSources?: MediaSource[] | null;
    blurredMediaSources?: MediaSource[] | null;
  } | null;
  subreddit?: {
    id?: number | string | null;
    url?: string | null;
    title?: string | null;
    isPaid?: boolean | null;
    isNsfw?: boolean | null;
    previewUrl?: string | null;
  } | null;
  collection?: {
    id?: number | string | null;
    url?: string | null;
    title?: string | null;
    description?: string | null;
    is_nsfw?: boolean | null;
    item_count?: number | null;
    previewUrl?: string | null;
  } | null;
}

/** getPostRecommendations ("More like this") — subreddit URLs only; the API
 * has no post-level related-posts query (T1 §3a). */
export interface PostRecommendations {
  subreddits?: Array<{ subredditUrl?: string | null }> | null;
}

/** Official agent routes (scrolller.com/agent/*, embed-safe, no raw media —
 * RESEARCH.md §4b). Loose JSON object. */
export type AgentResult = Record<string, unknown>;

export type AgentFormat = "json" | "ld+json";

// ---------------------------------------------------------------------------
// Option shapes
// ---------------------------------------------------------------------------

/** Shared gallery feed knobs. Nullable list/scalar variables are OMITTED from
 * the payload when unset (null-variable trap, CONTRACT.md §1) — always pass
 * `undefined`, never `null`, for unset filter/sort options. */
export interface FeedOptions {
  nsfw?: NsfwFilter;
  sortBy?: GallerySortBy;
  filter?: GalleryFilter;
}

/** Iterator feeds: subreddit children, user/creator posts, collection content,
 * following feeds. `iterator` resumes a previous page byte-exact. */
export interface PostsFeedOptions extends FeedOptions {
  limit?: number;
  iterator?: string | null;
}

export interface DiscoverOptions extends FeedOptions {
  /** Subreddit cards per page (site home feed: ceil(desiredPosts/2)). */
  limit?: number;
  /** Posts embedded per subreddit card (site: 2 home, 1 category views). */
  childLimit?: number;
  /** Resume cursor — pass a previous response's `iterator` byte-exact. */
  iterator?: string | null;
  includeFilters?: number[];
  excludeFilters?: number[];
}

export interface SubredditFeedOptions extends FeedOptions {
  limit?: number;
}

/** Continuation options for subredditChildren (SubredditChildrenQuery). */
export interface SubredditChildrenOptions extends FeedOptions {
  limit?: number;
  /** Resume cursor — pass a previous page's `iterator` byte-exact ("x;y" format). */
  iterator?: string | null;
}

export interface SearchOptions {
  limit?: number;
  pageIndex?: number;
}

export interface SearchSubredditsOptions extends SearchOptions {
  /** $isNsfw is `Boolean!` in the SDL. Default: derived from client nsfw config (NSFW→true, else false). */
  isNsfw?: boolean;
}

/** {limit} auto-paging for list* helpers. */
export interface ListOptions {
  /** Stop after collecting this many items (default: read until exhausted). */
  limit?: number;
}

export interface CommentsOptions {
  /** Site default: 15 top-level, 3 for replies. */
  limit?: number;
  /** Cursor = last comment id of the previous page. */
  cursor?: number | null;
}

export interface NotificationsOptions {
  page?: number;
  limit?: number;
  /** Notifications filter enum (T1 §4); input-object field is bundle-inferred. */
  filter?: "ALL" | "ARCHIVED";
}

export interface ConversationsOptions {
  limit?: number;
  cursor?: string | null;
}

export interface MessagesOptions {
  limit?: number;
  page?: number;
}

export interface PaidCollectionsOptions {
  isNsfw?: boolean;
  limit?: number;
  iterator?: string | null;
}

export interface AgentOptions {
  format?: AgentFormat;
  /** Only honored by /agent/subreddit and /agent/collection (?limit=N). */
  limit?: number;
}

/** Loose passthrough for PostsByTagInput — the T1 report does not name the tag
 * field; known-shared gallery fields are typed, everything else is forwarded. */
export interface PostsByTagData extends FeedOptions {
  iterator?: string | null;
  limit?: number;
  [key: string]: unknown;
}

/** Collection create/edit options ($is_private/$is_nsfw are Boolean! — defaults false). */
export interface CollectionMutationOptions {
  description?: string;
  isPrivate?: boolean;
  isNsfw?: boolean;
}

// ---------------------------------------------------------------------------
// ScrolllerClient operation surface (CONTRACT.md §6; implemented in src/ops/*,
// attached to ScrolllerClient.prototype — see client.ts).
// ---------------------------------------------------------------------------

/** Convref: a Scrolller post URL/path (string) or a numeric post id. */
export type PostRef = string | number;

export interface ScrolllerOps {
  // feed.ts — public reads -------------------------------------------------
  /** Discover feed page 1 (DiscoverFilteredSubredditsQuery). */
  discover(options?: DiscoverOptions): Promise<DiscoverResult>;
  /** Discover feed pages; yields full pages (iterator byte-exact inside). */
  discoverPages(options?: DiscoverOptions): AsyncGenerator<DiscoverResult>;
  /** Subreddit feed page 1 (SubredditQuery — subreddit card + embedded posts). */
  subredditFeed(name: string, options?: SubredditFeedOptions): Promise<SubredditFeedPage>;
  /** Subreddit posts across pages (SubredditQuery → SubredditChildrenQuery). */
  subredditPages(name: string, options?: SubredditFeedOptions): AsyncGenerator<SubredditFeedPage>;
  /** Collect up to `limit` posts from a subreddit feed. */
  listSubredditPosts(name: string, options?: SubredditFeedOptions & ListOptions): Promise<PostResult[]>;
  /** One SubredditChildrenQuery page: continue a subreddit feed by its
   * SubredditFeedPage (id + iterator taken from it) or by a numeric subreddit id. */
  subredditChildren(feed: SubredditFeedPage | number, options?: SubredditChildrenOptions): Promise<FeedPage<PostResult>>;
  /** Subreddit autocomplete (SearchSubredditsQuery; pageIndex pagination). */
  searchSubreddits(query: string, options?: SearchSubredditsOptions): Promise<SearchSubredditResult[]>;
  searchSubredditsPages(query: string, options?: SearchSubredditsOptions): AsyncGenerator<SearchSubredditResult[]>;
  listSearchSubreddits(query: string, options?: SearchSubredditsOptions & ListOptions): Promise<SearchSubredditResult[]>;
  /** Search-page subreddit cards (SearchSubredditWithPreview; pageIndex). */
  searchSubredditWithPreview(query: string, options?: SearchOptions): Promise<SearchSubredditPreviewResult[]>;
  searchSubredditWithPreviewPages(query: string, options?: SearchOptions): AsyncGenerator<SearchSubredditPreviewResult[]>;
  listSearchSubredditPreviews(query: string, options?: SearchOptions & ListOptions): Promise<SearchSubredditPreviewResult[]>;
  /** Scrolller-user search (SearchUsersQuery; pageIndex pagination). */
  searchUsers(query: string, options?: SearchOptions): Promise<SearchUserResult[]>;
  searchUsersPages(query: string, options?: SearchOptions): AsyncGenerator<SearchUserResult[]>;
  listSearchUsers(query: string, options?: SearchOptions & ListOptions): Promise<SearchUserResult[]>;
  /** Category tree for includeFilters/excludeFilters ids (getCategories). */
  categories(options?: { sort?: string | null; nsfw?: boolean }): Promise<CategoryNode[]>;

  // posts.ts — public reads ------------------------------------------------
  /** Post by scrolller URL (SubredditPostQuery). */
  getPost(url: string): Promise<PostResult>;
  /** Resolve scrolller.com links (ResolveScrolllerLinks). */
  resolveLinks(urls: string[]): Promise<ResolvedLinkResult[]>;
  /** Resolve one scrolller link; null when the server does not know it. */
  resolveLink(url: string): Promise<ResolvedLinkResult | null>;
  /** "More like this" (GetAllRecommendationsContent) — subreddit URLs only. */
  related(ref: PostRef): Promise<PostRecommendations>;
  /** Tag feed (PostsByTag; $data passthrough — tag field name unverified). */
  postsByTag(data: PostsByTagData): Promise<FeedPage<PostWithTagResult>>;
  postsByTagPages(data: PostsByTagData): AsyncGenerator<FeedPage<PostWithTagResult>>;
  listPostsByTag(data: PostsByTagData & ListOptions): Promise<PostWithTagResult[]>;
  /** Hidden tags of a post (PostHiddenTags). */
  getPostHiddenTags(postId: number): Promise<TagLink[]>;
  /** Posts by (followed) creators feed (GetPostsByCreators). */
  getPostsByCreators(options?: PostsFeedOptions): Promise<FeedPage<PostResult>>;
  getPostsByCreatorsPages(options?: PostsFeedOptions): AsyncGenerator<FeedPage<PostResult>>;
  listCreatorPosts(options?: PostsFeedOptions & ListOptions): Promise<PostResult[]>;
  /** Scrolller user profile posts (UserPostsQuery). */
  getUserPosts(username: string, options?: PostsFeedOptions): Promise<FeedPage<PostResult>>;
  getUserPostsPages(username: string, options?: PostsFeedOptions): AsyncGenerator<FeedPage<PostResult>>;
  listUserPosts(username: string, options?: PostsFeedOptions & ListOptions): Promise<PostResult[]>;
  /** Reddit-user mirror posts (RedditUserPostsQuery). */
  getRedditUserPosts(username: string, options?: PostsFeedOptions): Promise<FeedPage<PostResult>>;
  getRedditUserPostsPages(username: string, options?: PostsFeedOptions): AsyncGenerator<FeedPage<PostResult>>;
  listRedditUserPosts(username: string, options?: PostsFeedOptions & ListOptions): Promise<PostResult[]>;

  // comments.ts ------------------------------------------------------------
  /** Top-level comments of a post — PLAIN ARRAY (cursor = last comment id). */
  getComments(ref: PostRef, options?: CommentsOptions): Promise<CommentResult[]>;
  getCommentsPages(ref: PostRef, options?: CommentsOptions): AsyncGenerator<CommentResult[]>;
  listComments(ref: PostRef, options?: CommentsOptions & ListOptions): Promise<CommentResult[]>;
  /** Replies of one comment — PLAIN ARRAY (site default limit 3). */
  getRepliesFromComment(commentId: number, options?: CommentsOptions): Promise<CommentResult[]>;
  getRepliesFromCommentPages(commentId: number, options?: CommentsOptions): AsyncGenerator<CommentResult[]>;
  listRepliesFromComment(commentId: number, options?: CommentsOptions & ListOptions): Promise<CommentResult[]>;
  /** Write comments (🔒 fail-fast AUTH_REQUIRED without token). */
  createComment(ref: PostRef, content: string): Promise<CommentWriteResult>;
  createCommentReply(content: string, parentCommentId: number): Promise<CommentWriteResult>;
  likeComment(commentId: number): Promise<boolean>;
  unlikeComment(commentId: number): Promise<boolean>;
  deleteComment(commentId: number): Promise<CommentWriteResult>;
  reportComment(commentId: number, reason: string, details?: string): Promise<boolean>;

  // collections.ts ----------------------------------------------------------
  collections(): Promise<CollectionResult[]>;
  collection(id: number): Promise<CollectionResult>;
  collectionByUrl(url: string): Promise<CollectionResult>;
  collectionContent(collectionId: number, options?: PostsFeedOptions): Promise<FeedPage<PostResult>>;
  collectionContentPages(collectionId: number, options?: PostsFeedOptions): AsyncGenerator<FeedPage<PostResult>>;
  listCollectionContent(collectionId: number, options?: PostsFeedOptions & ListOptions): Promise<PostResult[]>;
  createCollection(title: string, options?: CollectionMutationOptions): Promise<CollectionResult>;
  editCollection(id: number, title: string, options?: CollectionMutationOptions): Promise<CollectionResult>;
  deleteCollection(id: number): Promise<boolean>;
  collectionAddPost(postId: number, collectionId: number): Promise<boolean>;
  collectionRemovePost(postId: number, collectionId: number): Promise<boolean>;
  collectionSetup(collectionId: number): Promise<CollectionSetupResult>;
  paidCollections(options?: PaidCollectionsOptions): Promise<FeedPage<CollectionResult>>;
  paidCollectionsPages(options?: PaidCollectionsOptions): AsyncGenerator<FeedPage<CollectionResult>>;
  listPaidCollections(options?: PaidCollectionsOptions & ListOptions): Promise<CollectionResult[]>;

  // social.ts ---------------------------------------------------------------
  like(url: string): Promise<boolean>;
  unlike(url: string): Promise<boolean>;
  isFavorite(url: string): Promise<boolean>;
  repost(url: string): Promise<boolean>;
  unrepost(url: string): Promise<boolean>;
  follow(url: string): Promise<boolean>;
  unfollow(url: string): Promise<boolean>;
  isFollowingSubreddit(ids: number[]): Promise<IsFollowingEntry[]>;
  isFollowingUser(ref: { id?: number; username?: string }): Promise<{ isFollowing?: boolean | null }>;
  isFollowingUserCollection(id: number): Promise<boolean>;
  followingSubreddits(options?: PostsFeedOptions): Promise<FeedPage<SubredditResult>>;
  followingSubredditsPages(options?: PostsFeedOptions): AsyncGenerator<FeedPage<SubredditResult>>;
  listFollowingSubreddits(options?: PostsFeedOptions & ListOptions): Promise<SubredditResult[]>;
  followingCollections(options?: PostsFeedOptions): Promise<FeedPage<CollectionResult>>;
  followingCollectionsPages(options?: PostsFeedOptions): AsyncGenerator<FeedPage<CollectionResult>>;
  listFollowingCollections(options?: PostsFeedOptions & ListOptions): Promise<CollectionResult[]>;
  allFollowingContent(): Promise<AllFollowingContent>;
  hideContent(input: HideContentInput): Promise<HideRuleResult | null>;
  unhideContent(input: HideContentInput): Promise<boolean>;
  hideRules(): Promise<HideRuleResult[]>;
  hideRulesWithUrl(): Promise<HideRuleWithUrlResult[]>;
  reportPost(postId: number, reason: string, details?: string): Promise<boolean>;
  reportUser(userId: number, reason: string, details?: string): Promise<boolean>;
  reportCollection(collectionId: number, reason: string, details?: string): Promise<boolean>;

  // account.ts --------------------------------------------------------------
  /** Login with credentials; persists the token to the config file. */
  login(username: string, password: string): Promise<LoginResult>;
  /** Clear the token from the client and its config file. */
  logout(): void;
  me(): Promise<LoggedInUserResult>;
  updateUser(input: UpdateUserInput): Promise<boolean>;
  updateInfo(): Promise<boolean>;
  markPostWithSound(postId: number, hasAudio: boolean): Promise<boolean>;
  /** Premium plans — public (PlanQuery is live-verified anonymous). */
  plans(): Promise<PlanResult[]>;
  /** Card info on file (Account). */
  account(): Promise<AccountResult>;
  /** Active subscription (Subscription). */
  subscription(): Promise<SubscriptionResult>;
  creatorReport(): Promise<CreatorReportResult>;
  revShare(): Promise<number | null>;
  /** PUT https://host8.scrolller.com/upload (multipart) → {url, sourceSetId}. */
  uploadMedia(source: UploadSource, options?: { blur?: boolean }): Promise<UploadResult>;
  /** Publish an uploaded media set as a creator post (addCreatorPost). */
  createCreatorPost(input: CreatorPostInput): Promise<CreatorPostResult>;

  // messaging.ts ------------------------------------------------------------
  notifications(options?: NotificationsOptions): Promise<NotificationResult[]>;
  notificationsPages(options?: NotificationsOptions): AsyncGenerator<NotificationResult[]>;
  listNotifications(options?: NotificationsOptions & ListOptions): Promise<NotificationResult[]>;
  markAllNotificationsAsRead(): Promise<boolean>;
  markNotificationAsArchived(id: number): Promise<boolean>;
  markNotificationAsUnarchived(id: number): Promise<boolean>;
  conversations(options?: ConversationsOptions): Promise<ConversationsPage>;
  conversationsPages(options?: ConversationsOptions): AsyncGenerator<ConversationsPage>;
  listConversations(options?: ConversationsOptions & ListOptions): Promise<ConversationResult[]>;
  /** Messages of one conversation (by other-user id or conversation object). */
  messages(conversation: number | ConversationResult, options?: MessagesOptions): Promise<MessagesPage>;
  messagesPages(conversation: number | ConversationResult, options?: MessagesOptions): AsyncGenerator<MessagesPage>;
  listMessages(conversation: number | ConversationResult, options?: MessagesOptions & ListOptions): Promise<MessageResult[]>;
  sendMessage(receiverId: number, content: string): Promise<MessageResult>;
  markMessagesAsRead(senderId: number): Promise<boolean>;
  totalUnreadCount(): Promise<number | null>;

  // agent.ts — public embed-safe surface ------------------------------------
  agentSubreddit(slug: string, options?: AgentOptions): Promise<AgentResult>;
  agentContent(slug: string, options?: AgentOptions): Promise<AgentResult>;
  agentCollection(id: number | string, options?: AgentOptions): Promise<AgentResult>;
}

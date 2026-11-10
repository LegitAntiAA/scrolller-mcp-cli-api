/** Social operations: favorites, reposts, follows, hide rules, reports
 * (CONTRACT.md §6 rows 8–10, 21, 27). All 🔒 — fail-fast AUTH_REQUIRED
 * (CONTRACT.md §5.1) before any network call; T1 §2 lists these families
 * behind the logged-in gate.
 */
import { ScrolllerClient } from "../client.js";
import {
  ADD_FAVORITE_MUTATION,
  FOLLOW_MUTATION,
  GET_ALL_FOLLOWING_CONTENT_QUERY,
  GET_IS_FOLLOWING_SUBREDDIT_QUERY,
  GET_IS_FOLLOWING_USER_COLLECTION_QUERY,
  GET_IS_FOLLOWING_USER_QUERY,
  GET_POST_IS_FAVORITE_QUERY,
  GET_FOLLOWING_COLLECTIONS_QUERY,
  GET_FOLLOWING_SUBREDDITS_QUERY,
  GET_USER_HIDE_CONTENT_RULES_QUERY,
  GET_USER_HIDE_CONTENT_RULES_WITH_URL_QUERY,
  HIDE_CONTENT_MUTATION,
  REMOVE_FAVORITE_MUTATION,
  REMOVE_REPOST_MUTATION,
  REPOST_POST_MUTATION,
  REPORT_COLLECTION_MUTATION,
  REPORT_POST_MUTATION,
  REPORT_USER_MUTATION,
  UNFOLLOW_MUTATION,
  UNHIDE_CONTENT_MUTATION,
} from "../queries.js";
import { isExhaustedCursor } from "../paging.js";
import { expectField } from "../op-utils.js";
import type {
  AllFollowingContent,
  CollectionResult,
  FeedPage,
  HideContentInput,
  HideRuleResult,
  HideRuleWithUrlResult,
  IsFollowingEntry,
  ListOptions,
  PostsFeedOptions,
  SubredditResult,
} from "../op-types.js";

const DEFAULT_POSTS_LIMIT = 10; // site default for the following feeds (T1 §6)

async function like(this: ScrolllerClient, url: string): Promise<boolean> {
  this.requireAuth();
  const data = await this.requestMutation(ADD_FAVORITE_MUTATION, { url });
  return expectField<boolean>(data, "addFavorite");
}

async function unlike(this: ScrolllerClient, url: string): Promise<boolean> {
  this.requireAuth();
  const data = await this.requestMutation(REMOVE_FAVORITE_MUTATION, { url });
  return expectField<boolean>(data, "removeFavorite");
}

async function isFavorite(this: ScrolllerClient, url: string): Promise<boolean> {
  this.requireAuth();
  const data = await this.request(GET_POST_IS_FAVORITE_QUERY, { url });
  return expectField<boolean>(data, "getPostIsFavorite");
}

async function repost(this: ScrolllerClient, url: string): Promise<boolean> {
  this.requireAuth();
  const data = await this.requestMutation(REPOST_POST_MUTATION, { url });
  return expectField<boolean>(data, "repostPost");
}

async function unrepost(this: ScrolllerClient, url: string): Promise<boolean> {
  this.requireAuth();
  const data = await this.requestMutation(REMOVE_REPOST_MUTATION, { url });
  return expectField<boolean>(data, "removeRepost");
}

async function follow(this: ScrolllerClient, url: string): Promise<boolean> {
  this.requireAuth();
  // Works for both /r/... subreddit and user URLs (CONTRACT.md row 10).
  const data = await this.requestMutation(FOLLOW_MUTATION, { url });
  return expectField<boolean>(data, "follow");
}

async function unfollow(this: ScrolllerClient, url: string): Promise<boolean> {
  this.requireAuth();
  // NOTE: the bundle ships this document with the operation name `Follow` too (T1 §3d).
  const data = await this.requestMutation(UNFOLLOW_MUTATION, { url });
  return expectField<boolean>(data, "unfollow");
}

async function isFollowingSubreddit(this: ScrolllerClient, ids: number[]): Promise<IsFollowingEntry[]> {
  this.requireAuth();
  const data = await this.request(GET_IS_FOLLOWING_SUBREDDIT_QUERY, { ids });
  return expectField<IsFollowingEntry[]>(data, "getIsFollowingSubreddit");
}

async function isFollowingUser(this: ScrolllerClient, ref: { id?: number; username?: string }): Promise<{ isFollowing?: boolean | null }> {
  this.requireAuth();
  const data = await this.request(GET_IS_FOLLOWING_USER_QUERY, { id: ref.id, username: ref.username });
  return expectField<{ isFollowing?: boolean | null }>(data, "getIsFollowingUser");
}

async function isFollowingUserCollection(this: ScrolllerClient, id: number): Promise<boolean> {
  this.requireAuth();
  const data = await this.request(GET_IS_FOLLOWING_USER_COLLECTION_QUERY, { id });
  return expectField<boolean>(data, "getIsFollowingUserCollection");
}

async function followingSubredditsPage(client: ScrolllerClient, options: PostsFeedOptions): Promise<FeedPage<SubredditResult>> {
  const data = await client.request(GET_FOLLOWING_SUBREDDITS_QUERY, {
    limit: options.limit ?? DEFAULT_POSTS_LIMIT,
    iterator: options.iterator,
    filter: options.filter, // undefined → omitted
    sortBy: options.sortBy,
    nsfw: client.effectiveNsfw(options.nsfw),
  });
  return expectField<FeedPage<SubredditResult>>(data, "getFollowingSubreddits");
}

async function followingSubreddits(this: ScrolllerClient, options: PostsFeedOptions = {}): Promise<FeedPage<SubredditResult>> {
  this.requireAuth();
  return followingSubredditsPage(this, options);
}

async function* followingSubredditsPages(this: ScrolllerClient, options: PostsFeedOptions = {}): AsyncGenerator<FeedPage<SubredditResult>> {
  this.requireAuth();
  let cursor = options.iterator ?? null;
  for (;;) {
    const page = await followingSubredditsPage(this, { ...options, iterator: cursor });
    yield page;
    if (isExhaustedCursor(page.iterator)) return;
    cursor = page.iterator;
  }
}

async function listFollowingSubreddits(this: ScrolllerClient, options: PostsFeedOptions & ListOptions = {}): Promise<SubredditResult[]> {
  this.requireAuth();
  const collected: SubredditResult[] = [];
  let cursor = options.iterator ?? null;
  for (;;) {
    const page = await followingSubredditsPage(this, { ...options, iterator: cursor });
    collected.push(...(page.items ?? []));
    if (options.limit != null && collected.length >= options.limit) return collected.slice(0, options.limit);
    if (isExhaustedCursor(page.iterator)) return collected;
    cursor = page.iterator;
  }
}

async function followingCollectionsPage(client: ScrolllerClient, options: PostsFeedOptions): Promise<FeedPage<CollectionResult>> {
  const data = await client.request(GET_FOLLOWING_COLLECTIONS_QUERY, {
    limit: options.limit ?? DEFAULT_POSTS_LIMIT,
    iterator: options.iterator,
    filter: options.filter,
    sortBy: options.sortBy,
    nsfw: client.effectiveNsfw(options.nsfw),
  });
  return expectField<FeedPage<CollectionResult>>(data, "getFollowingCollections");
}

async function followingCollections(this: ScrolllerClient, options: PostsFeedOptions = {}): Promise<FeedPage<CollectionResult>> {
  this.requireAuth();
  return followingCollectionsPage(this, options);
}

async function* followingCollectionsPages(this: ScrolllerClient, options: PostsFeedOptions = {}): AsyncGenerator<FeedPage<CollectionResult>> {
  this.requireAuth();
  let cursor = options.iterator ?? null;
  for (;;) {
    const page = await followingCollectionsPage(this, { ...options, iterator: cursor });
    yield page;
    if (isExhaustedCursor(page.iterator)) return;
    cursor = page.iterator;
  }
}

async function listFollowingCollections(this: ScrolllerClient, options: PostsFeedOptions & ListOptions = {}): Promise<CollectionResult[]> {
  this.requireAuth();
  const collected: CollectionResult[] = [];
  let cursor = options.iterator ?? null;
  for (;;) {
    const page = await followingCollectionsPage(this, { ...options, iterator: cursor });
    collected.push(...(page.items ?? []));
    if (options.limit != null && collected.length >= options.limit) return collected.slice(0, options.limit);
    if (isExhaustedCursor(page.iterator)) return collected;
    cursor = page.iterator;
  }
}

async function allFollowingContent(this: ScrolllerClient): Promise<AllFollowingContent> {
  this.requireAuth();
  const data = await this.request(GET_ALL_FOLLOWING_CONTENT_QUERY);
  return expectField<AllFollowingContent>(data, "getAllFollowingContent");
}

async function hideContent(this: ScrolllerClient, input: HideContentInput): Promise<HideRuleResult | null> {
  this.requireAuth();
  const data = await this.requestMutation(HIDE_CONTENT_MUTATION, { data: input });
  const wrapper = expectField<{ rule?: HideRuleResult | null } | null>(data, "hideContent");
  return wrapper?.rule ?? null;
}

async function unhideContent(this: ScrolllerClient, input: HideContentInput): Promise<boolean> {
  this.requireAuth();
  // UnhideContentInput shape is bundle-inferred (T1 §4) — same fields as HideContentInput.
  const data = await this.requestMutation(UNHIDE_CONTENT_MUTATION, { data: input });
  return expectField<boolean>(data, "unhideContent");
}

async function hideRules(this: ScrolllerClient): Promise<HideRuleResult[]> {
  this.requireAuth();
  const data = await this.request(GET_USER_HIDE_CONTENT_RULES_QUERY);
  return expectField<HideRuleResult[]>(data, "getUserHideContentRules");
}

async function hideRulesWithUrl(this: ScrolllerClient): Promise<HideRuleWithUrlResult[]> {
  this.requireAuth();
  const data = await this.request(GET_USER_HIDE_CONTENT_RULES_WITH_URL_QUERY);
  return expectField<HideRuleWithUrlResult[]>(data, "getUserHideContentRulesWithUrl");
}

async function reportPost(this: ScrolllerClient, postId: number, reason: string, details?: string): Promise<boolean> {
  this.requireAuth();
  const data = await this.requestMutation(REPORT_POST_MUTATION, { postId, reason, details });
  return expectField<boolean>(data, "reportPost");
}

async function reportUser(this: ScrolllerClient, userId: number, reason: string, details?: string): Promise<boolean> {
  this.requireAuth();
  const data = await this.requestMutation(REPORT_USER_MUTATION, { userId, reason, details });
  return expectField<boolean>(data, "reportUser");
}

async function reportCollection(this: ScrolllerClient, collectionId: number, reason: string, details?: string): Promise<boolean> {
  this.requireAuth();
  const data = await this.requestMutation(REPORT_COLLECTION_MUTATION, { collectionId, reason, details });
  return expectField<boolean>(data, "reportCollection");
}

ScrolllerClient.prototype.like = like;
ScrolllerClient.prototype.unlike = unlike;
ScrolllerClient.prototype.isFavorite = isFavorite;
ScrolllerClient.prototype.repost = repost;
ScrolllerClient.prototype.unrepost = unrepost;
ScrolllerClient.prototype.follow = follow;
ScrolllerClient.prototype.unfollow = unfollow;
ScrolllerClient.prototype.isFollowingSubreddit = isFollowingSubreddit;
ScrolllerClient.prototype.isFollowingUser = isFollowingUser;
ScrolllerClient.prototype.isFollowingUserCollection = isFollowingUserCollection;
ScrolllerClient.prototype.followingSubreddits = followingSubreddits;
ScrolllerClient.prototype.followingSubredditsPages = followingSubredditsPages;
ScrolllerClient.prototype.listFollowingSubreddits = listFollowingSubreddits;
ScrolllerClient.prototype.followingCollections = followingCollections;
ScrolllerClient.prototype.followingCollectionsPages = followingCollectionsPages;
ScrolllerClient.prototype.listFollowingCollections = listFollowingCollections;
ScrolllerClient.prototype.allFollowingContent = allFollowingContent;
ScrolllerClient.prototype.hideContent = hideContent;
ScrolllerClient.prototype.unhideContent = unhideContent;
ScrolllerClient.prototype.hideRules = hideRules;
ScrolllerClient.prototype.hideRulesWithUrl = hideRulesWithUrl;
ScrolllerClient.prototype.reportPost = reportPost;
ScrolllerClient.prototype.reportUser = reportUser;
ScrolllerClient.prototype.reportCollection = reportCollection;

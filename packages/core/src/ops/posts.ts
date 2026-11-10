/** Public post operations (CONTRACT.md §6 rows 2*, 5, 19, 28 + tags).
 *
 * *Row 2 "Search media" is intentionally absent — no search-media query exists
 * in the current build (T1 §6: search is a separate query family). "Related"
 * maps to GetAllRecommendationsContent (the only related-posts surface, T1 §3a).
 */
import { ScrolllerClient } from "../client.js";
import {
  GET_POST_RECOMMENDATIONS_QUERY,
  GET_POSTS_BY_CREATORS_QUERY,
  POST_HIDDEN_TAGS_QUERY,
  POSTS_BY_TAG_QUERY,
  REDDIT_USER_POSTS_QUERY,
  RESOLVE_SCROLLLER_LINKS_QUERY,
  SUBREDDIT_POST_QUERY,
  USER_POSTS_QUERY,
} from "../queries.js";
import { iteratedPages, listFromPages } from "../paging.js";
import { expectField, isNumericId } from "../op-utils.js";
import { NotFoundError } from "../errors.js";
import type {
  FeedPage,
  ListOptions,
  PostRecommendations,
  PostRef,
  PostResult,
  PostWithTagResult,
  PostsByTagData,
  PostsFeedOptions,
  ResolvedLinkResult,
  TagLink,
} from "../op-types.js";

const DEFAULT_POSTS_LIMIT = 25;
/** Site default for the creator feed (T1 §3a/§6). */
const DEFAULT_CREATOR_POSTS_LIMIT = 50;

async function getPost(this: ScrolllerClient, url: string): Promise<PostResult> {
  const data = await this.request(SUBREDDIT_POST_QUERY, { url });
  return expectField<PostResult>(data, "getPost");
}

async function resolveLinks(this: ScrolllerClient, urls: string[]): Promise<ResolvedLinkResult[]> {
  const data = await this.request(RESOLVE_SCROLLLER_LINKS_QUERY, { urls });
  return expectField<ResolvedLinkResult[]>(data, "resolveScrolllerLinks");
}

async function resolveLink(this: ScrolllerClient, url: string): Promise<ResolvedLinkResult | null> {
  const links = await this.resolveLinks([url]);
  return links[0] ?? null;
}

/** Resolve a post ref to a numeric post id: numbers pass through, bare integer
 * strings parse directly, URLs resolve via ResolveScrolllerLinks. */
async function resolvePostId(client: ScrolllerClient, ref: PostRef): Promise<number> {
  if (typeof ref === "number") return ref;
  const trimmed = ref.trim();
  if (isNumericId(trimmed)) return Number(trimmed);
  const link = await client.resolveLink(trimmed);
  const id = link?.post?.id;
  const parsed = typeof id === "number" ? id : typeof id === "string" ? Number(id) : NaN;
  if (!Number.isInteger(parsed)) {
    throw new NotFoundError(`cannot resolve post id from ref ${JSON.stringify(ref)}`);
  }
  return parsed;
}

async function related(this: ScrolllerClient, ref: PostRef): Promise<PostRecommendations> {
  const postId = await resolvePostId(this, ref);
  const data = await this.request(GET_POST_RECOMMENDATIONS_QUERY, { postId });
  return expectField<PostRecommendations>(data, "getPostRecommendations");
}

async function postsByTagPage(client: ScrolllerClient, data: PostsByTagData): Promise<FeedPage<PostWithTagResult>> {
  const input: PostsByTagData = { ...data, nsfw: data.nsfw ?? client.effectiveNsfw() };
  const response = await client.request(POSTS_BY_TAG_QUERY, { data: input });
  return expectField<FeedPage<PostWithTagResult>>(response, "getPostsByTag");
}

async function postsByTag(this: ScrolllerClient, data: PostsByTagData): Promise<FeedPage<PostWithTagResult>> {
  return postsByTagPage(this, data);
}

async function* postsByTagPages(this: ScrolllerClient, data: PostsByTagData): AsyncGenerator<FeedPage<PostWithTagResult>> {
  yield* iteratedPages<PostWithTagResult>((iterator) => postsByTagPage(this, { ...data, iterator }), data.iterator ?? null);
}

async function listPostsByTag(this: ScrolllerClient, data: PostsByTagData & ListOptions = {}): Promise<PostWithTagResult[]> {
  const collected: PostWithTagResult[] = [];
  for await (const page of this.postsByTagPages(data)) {
    collected.push(...page.items);
    if (data.limit != null && collected.length >= data.limit) {
      return collected.slice(0, data.limit);
    }
  }
  return collected;
}

async function getPostHiddenTags(this: ScrolllerClient, postId: number): Promise<TagLink[]> {
  const data = await this.request(POST_HIDDEN_TAGS_QUERY, { postId });
  return expectField<TagLink[]>(data, "getPostHiddenTags");
}

function iteratorPostsPage(client: ScrolllerClient, query: string, variables: Record<string, unknown>, key: string): Promise<FeedPage<PostResult>> {
  return client.request(query, variables).then((data) => expectField<FeedPage<PostResult>>(data, key));
}

async function getPostsByCreators(this: ScrolllerClient, options: PostsFeedOptions = {}): Promise<FeedPage<PostResult>> {
  return iteratorPostsPage(this, GET_POSTS_BY_CREATORS_QUERY, {
    limit: options.limit ?? DEFAULT_CREATOR_POSTS_LIMIT,
    iterator: options.iterator, // site uses "" as start cursor; omission is equivalent
    filter: options.filter, // undefined → omitted
    sortBy: options.sortBy,
    nsfw: this.effectiveNsfw(options.nsfw),
  }, "getPostsByCreators");
}

async function* getPostsByCreatorsPages(this: ScrolllerClient, options: PostsFeedOptions = {}): AsyncGenerator<FeedPage<PostResult>> {
  yield* iteratedPages<PostResult>((iterator) => this.getPostsByCreators({ ...options, iterator }), options.iterator ?? null);
}

async function listCreatorPosts(this: ScrolllerClient, options: PostsFeedOptions & ListOptions = {}): Promise<PostResult[]> {
  const collected: PostResult[] = [];
  for await (const page of this.getPostsByCreatorsPages(options)) {
    collected.push(...page.items);
    if (options.limit != null && collected.length >= options.limit) {
      return collected.slice(0, options.limit);
    }
  }
  return collected;
}

async function getUserPosts(this: ScrolllerClient, username: string, options: PostsFeedOptions = {}): Promise<FeedPage<PostResult>> {
  return iteratorPostsPage(this, USER_POSTS_QUERY, {
    username,
    limit: options.limit ?? DEFAULT_POSTS_LIMIT,
    iterator: options.iterator,
    filter: options.filter,
    sortBy: options.sortBy,
    nsfw: this.effectiveNsfw(options.nsfw),
  }, "getUserPosts");
}

async function* getUserPostsPages(this: ScrolllerClient, username: string, options: PostsFeedOptions = {}): AsyncGenerator<FeedPage<PostResult>> {
  yield* iteratedPages<PostResult>((iterator) => this.getUserPosts(username, { ...options, iterator }), options.iterator ?? null);
}

async function listUserPosts(this: ScrolllerClient, username: string, options: PostsFeedOptions & ListOptions = {}): Promise<PostResult[]> {
  const collected: PostResult[] = [];
  for await (const page of this.getUserPostsPages(username, options)) {
    collected.push(...page.items);
    if (options.limit != null && collected.length >= options.limit) {
      return collected.slice(0, options.limit);
    }
  }
  return collected;
}

async function getRedditUserPosts(this: ScrolllerClient, username: string, options: PostsFeedOptions = {}): Promise<FeedPage<PostResult>> {
  return iteratorPostsPage(this, REDDIT_USER_POSTS_QUERY, {
    username,
    limit: options.limit ?? DEFAULT_POSTS_LIMIT,
    iterator: options.iterator,
    filter: options.filter,
    sortBy: options.sortBy,
    nsfw: this.effectiveNsfw(options.nsfw),
  }, "getRedditUserPosts");
}

async function* getRedditUserPostsPages(this: ScrolllerClient, username: string, options: PostsFeedOptions = {}): AsyncGenerator<FeedPage<PostResult>> {
  yield* iteratedPages<PostResult>((iterator) => this.getRedditUserPosts(username, { ...options, iterator }), options.iterator ?? null);
}

async function listRedditUserPosts(this: ScrolllerClient, username: string, options: PostsFeedOptions & ListOptions = {}): Promise<PostResult[]> {
  const collected: PostResult[] = [];
  for await (const page of this.getRedditUserPostsPages(username, options)) {
    collected.push(...page.items);
    if (options.limit != null && collected.length >= options.limit) {
      return collected.slice(0, options.limit);
    }
  }
  return collected;
}

ScrolllerClient.prototype.getPost = getPost;
ScrolllerClient.prototype.resolveLinks = resolveLinks;
ScrolllerClient.prototype.resolveLink = resolveLink;
ScrolllerClient.prototype.related = related;
ScrolllerClient.prototype.postsByTag = postsByTag;
ScrolllerClient.prototype.postsByTagPages = postsByTagPages;
ScrolllerClient.prototype.listPostsByTag = listPostsByTag;
ScrolllerClient.prototype.getPostHiddenTags = getPostHiddenTags;
ScrolllerClient.prototype.getPostsByCreators = getPostsByCreators;
ScrolllerClient.prototype.getPostsByCreatorsPages = getPostsByCreatorsPages;
ScrolllerClient.prototype.listCreatorPosts = listCreatorPosts;
ScrolllerClient.prototype.getUserPosts = getUserPosts;
ScrolllerClient.prototype.getUserPostsPages = getUserPostsPages;
ScrolllerClient.prototype.listUserPosts = listUserPosts;
ScrolllerClient.prototype.getRedditUserPosts = getRedditUserPosts;
ScrolllerClient.prototype.getRedditUserPostsPages = getRedditUserPostsPages;
ScrolllerClient.prototype.listRedditUserPosts = listRedditUserPosts;

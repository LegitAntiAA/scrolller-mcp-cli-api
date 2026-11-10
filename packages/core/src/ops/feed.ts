/** Public feed/search operations (CONTRACT.md §6 rows 1, 3, 4, 29 + categories).
 *
 * All methods are public (no token). Iterator cursors are passed back
 * byte-exact; pageIndex searches auto-increment; unset nullable filter
 * variables are omitted from the payload (null-variable trap).
 */
import { ScrolllerClient } from "../client.js";
import {
  DISCOVER_QUERY,
  GET_CATEGORIES_QUERY,
  SEARCH_SUBREDDITS_QUERY,
  SEARCH_SUBREDDIT_WITH_PREVIEW_QUERY,
  SEARCH_USERS_QUERY,
  SUBREDDIT_CHILDREN_QUERY,
  SUBREDDIT_QUERY,
} from "../queries.js";
import { isExhaustedCursor, iteratedPages, listFromPages, pagedByIndex } from "../paging.js";
import { expectField, toSubredditUrl } from "../op-utils.js";
import { NotFoundError } from "../errors.js";
import type {
  CategoryNode,
  DiscoverOptions,
  DiscoverResult,
  FeedPage,
  ListOptions,
  PostResult,
  SearchOptions,
  SearchSubredditPreviewResult,
  SearchSubredditResult,
  SearchSubredditsOptions,
  SearchUserResult,
  SubredditChildrenOptions,
  SubredditFeedOptions,
  SubredditFeedPage,
  SubredditResult,
} from "../op-types.js";

const DEFAULT_DISCOVER_LIMIT = 10;
const DEFAULT_DISCOVER_CHILD_LIMIT = 2;
const DEFAULT_POSTS_LIMIT = 25;
const DEFAULT_SEARCH_LIMIT = 20;

async function discover(this: ScrolllerClient, options: DiscoverOptions = {}): Promise<DiscoverResult> {
  const data = await this.request(DISCOVER_QUERY, {
    limit: options.limit ?? DEFAULT_DISCOVER_LIMIT,
    childLimit: options.childLimit ?? DEFAULT_DISCOVER_CHILD_LIMIT,
    iterator: options.iterator, // omitted when unset (accepted as null too)
    nsfw: this.effectiveNsfw(options.nsfw),
    sortBy: options.sortBy, // undefined → omitted (null-variable trap)
    filter: options.filter,
    includeFilters: options.includeFilters,
    excludeFilters: options.excludeFilters,
  });
  return expectField<DiscoverResult>(data, "discoverFilteredSubreddits");
}

async function* discoverPages(this: ScrolllerClient, options: DiscoverOptions = {}): AsyncGenerator<DiscoverResult> {
  yield* iteratedPages<SubredditResult>((iterator) => this.discover({ ...options, iterator }), options.iterator ?? null);
}

async function subredditFeed(this: ScrolllerClient, name: string, options: SubredditFeedOptions = {}): Promise<SubredditFeedPage> {
  // The embedded children of getSubreddit carry no server-side args (T1 §3b);
  // the continuation cursor comes from children.iterator and is fed into
  // SubredditChildrenQuery (which has its own $nsfw).
  const data = await this.request(SUBREDDIT_QUERY, {
    url: toSubredditUrl(name),
    limit: options.limit ?? DEFAULT_POSTS_LIMIT,
    sortBy: options.sortBy, // undefined → omitted
    filter: options.filter,
  });
  const subreddit = expectField<SubredditResult>(data, "getSubreddit");
  const children = subreddit?.children;
  return {
    iterator: children?.iterator ?? null,
    items: children?.items ?? [],
    subreddit,
  };
}

async function* subredditPages(this: ScrolllerClient, name: string, options: SubredditFeedOptions = {}): AsyncGenerator<SubredditFeedPage> {
  const first = await this.subredditFeed(name, options);
  yield first;
  const subredditId = first.subreddit?.id;
  if (subredditId === null || subredditId === undefined) return;

  const nsfw = this.effectiveNsfw(options.nsfw);
  const limit = options.limit ?? DEFAULT_POSTS_LIMIT;
  let cursor = first.iterator;
  while (!isExhaustedCursor(cursor)) {
    const data = await this.request(SUBREDDIT_CHILDREN_QUERY, {
      subredditId,
      iterator: cursor, // byte-exact pass-through ("x;y" format)
      filter: options.filter,
      sortBy: options.sortBy,
      limit,
      nsfw,
    });
    const page = expectField<FeedPage<PostResult>>(data, "getSubredditChildren");
    yield { iterator: page.iterator ?? null, items: page.items ?? [] };
    if (isExhaustedCursor(page.iterator)) return;
    cursor = page.iterator ?? null;
  }
}

async function listSubredditPosts(this: ScrolllerClient, name: string, options: SubredditFeedOptions & ListOptions = {}): Promise<PostResult[]> {
  const collected: PostResult[] = [];
  for await (const page of this.subredditPages(name, options)) {
    collected.push(...page.items);
    if (options.limit != null && collected.length >= options.limit) {
      return collected.slice(0, options.limit);
    }
  }
  return collected;
}

async function subredditChildren(this: ScrolllerClient, feed: SubredditFeedPage | number, options: SubredditChildrenOptions = {}): Promise<FeedPage<PostResult>> {
  let subredditId: number | string | null | undefined;
  if (typeof feed === "number") {
    subredditId = feed;
  } else {
    subredditId = feed.subreddit?.id;
    if (options.iterator === undefined && feed.iterator) {
      // Continue exactly where the feed page stopped (byte-exact cursor).
      options = { ...options, iterator: feed.iterator };
    }
  }
  if (subredditId === null || subredditId === undefined) {
    throw new NotFoundError("subredditChildren needs a subreddit id (pass a numeric id or a subredditFeed result carrying subreddit.id)");
  }
  const data = await this.request(SUBREDDIT_CHILDREN_QUERY, {
    subredditId,
    iterator: options.iterator, // byte-exact pass-through ("x;y" format)
    filter: options.filter, // undefined → omitted
    sortBy: options.sortBy,
    limit: options.limit ?? DEFAULT_POSTS_LIMIT,
    nsfw: this.effectiveNsfw(options.nsfw),
  });
  const page = expectField<FeedPage<PostResult>>(data, "getSubredditChildren");
  return { iterator: page.iterator ?? null, items: page.items ?? [] };
}

async function searchSubredditsPage(
  client: ScrolllerClient,
  query: string,
  pageIndex: number,
  limit: number,
  isNsfw: boolean,
): Promise<SearchSubredditResult[]> {
  const data = await client.request(SEARCH_SUBREDDITS_QUERY, { query, limit, pageIndex, isNsfw });
  return expectField<SearchSubredditResult[]>(data, "searchSubreddits");
}

// $isNsfw is Boolean! in the SDL — derive it from the client nsfw config unless
// given explicitly (NSFW → true; SFW/ALL → false; ALL cannot be a boolean).
function derivedIsNsfw(client: ScrolllerClient, explicit?: boolean): boolean {
  return explicit ?? (client.config.nsfw === "NSFW" ? true : false);
}

async function searchSubreddits(this: ScrolllerClient, query: string, options: SearchSubredditsOptions = {}): Promise<SearchSubredditResult[]> {
  return searchSubredditsPage(this, query, options.pageIndex ?? 0, options.limit ?? DEFAULT_SEARCH_LIMIT, derivedIsNsfw(this, options.isNsfw));
}

async function* searchSubredditsPages(this: ScrolllerClient, query: string, options: SearchSubredditsOptions = {}): AsyncGenerator<SearchSubredditResult[]> {
  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
  const isNsfw = derivedIsNsfw(this, options.isNsfw);
  yield* pagedByIndex<SearchSubredditResult>((pageIndex) => searchSubredditsPage(this, query, pageIndex, limit, isNsfw), limit);
}

async function listSearchSubreddits(this: ScrolllerClient, query: string, options: SearchSubredditsOptions & ListOptions = {}): Promise<SearchSubredditResult[]> {
  return listFromPages(this.searchSubredditsPages(query, options), options.limit);
}

async function searchSubredditWithPreviewPage(
  client: ScrolllerClient,
  query: string,
  pageIndex: number,
  limit: number,
): Promise<SearchSubredditPreviewResult[]> {
  const data = await client.request(SEARCH_SUBREDDIT_WITH_PREVIEW_QUERY, { query, limit, pageIndex });
  return expectField<SearchSubredditPreviewResult[]>(data, "searchSubredditWithPreview");
}

async function searchSubredditWithPreview(this: ScrolllerClient, query: string, options: SearchOptions = {}): Promise<SearchSubredditPreviewResult[]> {
  return searchSubredditWithPreviewPage(this, query, options.pageIndex ?? 0, options.limit ?? DEFAULT_SEARCH_LIMIT);
}

async function* searchSubredditWithPreviewPages(this: ScrolllerClient, query: string, options: SearchOptions = {}): AsyncGenerator<SearchSubredditPreviewResult[]> {
  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
  yield* pagedByIndex<SearchSubredditPreviewResult>((pageIndex) => searchSubredditWithPreviewPage(this, query, pageIndex, limit), limit);
}

async function listSearchSubredditPreviews(this: ScrolllerClient, query: string, options: SearchOptions & ListOptions = {}): Promise<SearchSubredditPreviewResult[]> {
  return listFromPages(this.searchSubredditWithPreviewPages(query, options), options.limit);
}

async function searchUsersPage(client: ScrolllerClient, query: string, pageIndex: number, limit: number): Promise<SearchUserResult[]> {
  const data = await client.request(SEARCH_USERS_QUERY, { query, limit, pageIndex });
  return expectField<SearchUserResult[]>(data, "searchUsers");
}

async function searchUsers(this: ScrolllerClient, query: string, options: SearchOptions = {}): Promise<SearchUserResult[]> {
  return searchUsersPage(this, query, options.pageIndex ?? 0, options.limit ?? DEFAULT_SEARCH_LIMIT);
}

async function* searchUsersPages(this: ScrolllerClient, query: string, options: SearchOptions = {}): AsyncGenerator<SearchUserResult[]> {
  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
  yield* pagedByIndex<SearchUserResult>((pageIndex) => searchUsersPage(this, query, pageIndex, limit), limit);
}

async function listSearchUsers(this: ScrolllerClient, query: string, options: SearchOptions & ListOptions = {}): Promise<SearchUserResult[]> {
  return listFromPages(this.searchUsersPages(query, options), options.limit);
}

async function categories(this: ScrolllerClient, options: { sort?: string | null; nsfw?: boolean } = {}): Promise<CategoryNode[]> {
  // $nsfw is Boolean!; $sort (order_by) is a nullable String — omitted when unset.
  const nsfw = options.nsfw ?? (this.config.nsfw === "NSFW" ? true : false);
  const data = await this.request(GET_CATEGORIES_QUERY, { sort: options.sort, nsfw });
  return expectField<CategoryNode[]>(data, "categories");
}

ScrolllerClient.prototype.discover = discover;
ScrolllerClient.prototype.discoverPages = discoverPages;
ScrolllerClient.prototype.subredditFeed = subredditFeed;
ScrolllerClient.prototype.subredditPages = subredditPages;
ScrolllerClient.prototype.listSubredditPosts = listSubredditPosts;
ScrolllerClient.prototype.subredditChildren = subredditChildren;
ScrolllerClient.prototype.searchSubreddits = searchSubreddits;
ScrolllerClient.prototype.searchSubredditsPages = searchSubredditsPages;
ScrolllerClient.prototype.listSearchSubreddits = listSearchSubreddits;
ScrolllerClient.prototype.searchSubredditWithPreview = searchSubredditWithPreview;
ScrolllerClient.prototype.searchSubredditWithPreviewPages = searchSubredditWithPreviewPages;
ScrolllerClient.prototype.listSearchSubredditPreviews = listSearchSubredditPreviews;
ScrolllerClient.prototype.searchUsers = searchUsers;
ScrolllerClient.prototype.searchUsersPages = searchUsersPages;
ScrolllerClient.prototype.listSearchUsers = listSearchUsers;
ScrolllerClient.prototype.categories = categories;

/** Collection operations (CONTRACT.md §6 rows 11–14 + setup/paid).
 *
 * Classified 🔒 (fail-fast AUTH_REQUIRED) per CONTRACT.md rows 11–12 and the
 * T4-phase2 assignment; T1 §2 groups "collections" endpoints behind the
 * logged-in gate. Relaxing any of these to public requires live verification
 * and a CONTRACT update.
 */
import { ScrolllerClient } from "../client.js";
import {
  ADD_POST_TO_COLLECTION_MUTATION,
  CREATE_COLLECTION_MUTATION,
  DELETE_COLLECTION_MUTATION,
  EDIT_COLLECTION_MUTATION,
  GET_COLLECTION_BY_ID_QUERY,
  GET_COLLECTION_SETUP_QUERY,
  GET_USER_COLLECTION_CONTENT_QUERY,
  GET_USER_COLLECTION_QUERY,
  GET_USER_COLLECTIONS_QUERY,
  REMOVE_POST_FROM_COLLECTION_MUTATION,
  paidCollectionsQuery,
} from "../queries.js";
import { isExhaustedCursor, listFromPages } from "../paging.js";
import { expectField } from "../op-utils.js";
import type {
  CollectionMutationOptions,
  CollectionResult,
  CollectionSetupResult,
  FeedPage,
  ListOptions,
  PaidCollectionsOptions,
  PostResult,
  PostsFeedOptions,
} from "../op-types.js";

const DEFAULT_POSTS_LIMIT = 25;
const DEFAULT_PAID_LIMIT = 10;

async function collections(this: ScrolllerClient): Promise<CollectionResult[]> {
  this.requireAuth();
  const data = await this.request(GET_USER_COLLECTIONS_QUERY);
  return expectField<CollectionResult[]>(data, "getUserCollections");
}

async function collection(this: ScrolllerClient, id: number): Promise<CollectionResult> {
  this.requireAuth();
  const data = await this.request(GET_COLLECTION_BY_ID_QUERY, { collectionId: id });
  return expectField<CollectionResult>(data, "getCollection");
}

async function collectionByUrl(this: ScrolllerClient, url: string): Promise<CollectionResult> {
  this.requireAuth();
  const data = await this.request(GET_USER_COLLECTION_QUERY, { url });
  return expectField<CollectionResult>(data, "getUserCollection");
}

async function collectionContentPage(
  client: ScrolllerClient,
  collectionId: number,
  options: PostsFeedOptions,
): Promise<FeedPage<PostResult>> {
  const data = await client.request(GET_USER_COLLECTION_CONTENT_QUERY, {
    collectionId,
    limit: options.limit ?? DEFAULT_POSTS_LIMIT,
    iterator: options.iterator,
    filter: options.filter, // undefined → omitted
    sortBy: options.sortBy,
    nsfw: client.effectiveNsfw(options.nsfw),
  });
  return expectField<FeedPage<PostResult>>(data, "getUserCollectionContent");
}

async function collectionContent(this: ScrolllerClient, collectionId: number, options: PostsFeedOptions = {}): Promise<FeedPage<PostResult>> {
  this.requireAuth();
  return collectionContentPage(this, collectionId, options);
}

async function* collectionContentPages(this: ScrolllerClient, collectionId: number, options: PostsFeedOptions = {}): AsyncGenerator<FeedPage<PostResult>> {
  this.requireAuth();
  yield* iteratedCollectionPages(this, collectionId, options);
}

async function* iteratedCollectionPages(
  client: ScrolllerClient,
  collectionId: number,
  options: PostsFeedOptions,
): AsyncGenerator<FeedPage<PostResult>> {
  let cursor = options.iterator ?? null;
  for (;;) {
    const page = await collectionContentPage(client, collectionId, { ...options, iterator: cursor });
    yield page;
    if (isExhaustedCursor(page.iterator)) return;
    cursor = page.iterator;
  }
}

async function listCollectionContent(this: ScrolllerClient, collectionId: number, options: PostsFeedOptions & ListOptions = {}): Promise<PostResult[]> {
  this.requireAuth();
  const collected: PostResult[] = [];
  for await (const page of iteratedCollectionPages(this, collectionId, options)) {
    collected.push(...page.items);
    if (options.limit != null && collected.length >= options.limit) {
      return collected.slice(0, options.limit);
    }
  }
  return collected;
}

async function createCollection(this: ScrolllerClient, title: string, options: CollectionMutationOptions = {}): Promise<CollectionResult> {
  this.requireAuth();
  const data = await this.requestMutation(CREATE_COLLECTION_MUTATION, {
    title,
    description: options.description, // undefined → omitted
    is_private: options.isPrivate ?? false, // Boolean! — always sent
    is_nsfw: options.isNsfw ?? false,
  });
  return expectField<CollectionResult>(data, "createCollection");
}

async function editCollection(this: ScrolllerClient, id: number, title: string, options: CollectionMutationOptions = {}): Promise<CollectionResult> {
  this.requireAuth();
  const data = await this.requestMutation(EDIT_COLLECTION_MUTATION, {
    id,
    title,
    description: options.description,
    is_private: options.isPrivate ?? false,
    is_nsfw: options.isNsfw ?? false,
  });
  return expectField<CollectionResult>(data, "editCollection");
}

async function deleteCollection(this: ScrolllerClient, id: number): Promise<boolean> {
  this.requireAuth();
  const data = await this.requestMutation(DELETE_COLLECTION_MUTATION, { id });
  return expectField<boolean>(data, "deleteCollection");
}

async function collectionAddPost(this: ScrolllerClient, postId: number, collectionId: number): Promise<boolean> {
  this.requireAuth();
  const data = await this.requestMutation(ADD_POST_TO_COLLECTION_MUTATION, { postId, collectionId });
  return expectField<boolean>(data, "addPostToCollection");
}

async function collectionRemovePost(this: ScrolllerClient, postId: number, collectionId: number): Promise<boolean> {
  this.requireAuth();
  const data = await this.requestMutation(REMOVE_POST_FROM_COLLECTION_MUTATION, { postId, collectionId });
  return expectField<boolean>(data, "removePostFromCollection");
}

async function collectionSetup(this: ScrolllerClient, collectionId: number): Promise<CollectionSetupResult> {
  this.requireAuth();
  const data = await this.request(GET_COLLECTION_SETUP_QUERY, { collectionId });
  return expectField<CollectionSetupResult>(data, "getCollectionSetup");
}

async function paidCollectionsPage(client: ScrolllerClient, options: PaidCollectionsOptions): Promise<FeedPage<CollectionResult>> {
  // isNsfw/limit are interpolated LITERALS in the bundle document (T1 §3c).
  const isNsfw = options.isNsfw ?? false;
  const limit = options.limit ?? DEFAULT_PAID_LIMIT;
  const data = await client.request(paidCollectionsQuery(isNsfw, limit), { iterator: options.iterator });
  return expectField<FeedPage<CollectionResult>>(data, "getMyPaidCollections");
}

async function paidCollections(this: ScrolllerClient, options: PaidCollectionsOptions = {}): Promise<FeedPage<CollectionResult>> {
  this.requireAuth();
  return paidCollectionsPage(this, options);
}

async function* paidCollectionsPages(this: ScrolllerClient, options: PaidCollectionsOptions = {}): AsyncGenerator<FeedPage<CollectionResult>> {
  this.requireAuth();
  let cursor = options.iterator ?? null;
  for (;;) {
    const page = await paidCollectionsPage(this, { ...options, iterator: cursor });
    yield page;
    if (isExhaustedCursor(page.iterator)) return;
    cursor = page.iterator;
  }
}

async function listPaidCollections(this: ScrolllerClient, options: PaidCollectionsOptions & ListOptions = {}): Promise<CollectionResult[]> {
  this.requireAuth();
  const collected: CollectionResult[] = [];
  let cursor = options.iterator ?? null;
  for (;;) {
    const page = await paidCollectionsPage(this, { ...options, iterator: cursor });
    collected.push(...(page.items ?? []));
    if (options.limit != null && collected.length >= options.limit) {
      return collected.slice(0, options.limit);
    }
    if (isExhaustedCursor(page.iterator)) return collected;
    cursor = page.iterator;
  }
}

ScrolllerClient.prototype.collections = collections;
ScrolllerClient.prototype.collection = collection;
ScrolllerClient.prototype.collectionByUrl = collectionByUrl;
ScrolllerClient.prototype.collectionContent = collectionContent;
ScrolllerClient.prototype.collectionContentPages = collectionContentPages;
ScrolllerClient.prototype.listCollectionContent = listCollectionContent;
ScrolllerClient.prototype.createCollection = createCollection;
ScrolllerClient.prototype.editCollection = editCollection;
ScrolllerClient.prototype.deleteCollection = deleteCollection;
ScrolllerClient.prototype.collectionAddPost = collectionAddPost;
ScrolllerClient.prototype.collectionRemovePost = collectionRemovePost;
ScrolllerClient.prototype.collectionSetup = collectionSetup;
ScrolllerClient.prototype.paidCollections = paidCollections;
ScrolllerClient.prototype.paidCollectionsPages = paidCollectionsPages;
ScrolllerClient.prototype.listPaidCollections = listPaidCollections;

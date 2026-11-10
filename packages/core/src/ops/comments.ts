/** Comment operations (CONTRACT.md §6 rows 6, 7, 27).
 *
 * Reader queries return PLAIN ARRAYS — pagination cursor = last comment id;
 * stop when the returned array is shorter than the requested limit (T1 §3e).
 * Site limits: 15 top-level comments, 3 replies per page.
 *
 * Reads are public; all writes are 🔒 and fail fast with AUTH_REQUIRED
 * (CONTRACT.md §5.1) before any network call.
 */
import { ScrolllerClient } from "../client.js";
import {
  CREATE_COMMENT_MUTATION,
  CREATE_COMMENT_REPLY_MUTATION,
  DELETE_COMMENT_MUTATION,
  GET_COMMENTS_QUERY,
  GET_REPLIES_FROM_COMMENT_QUERY,
  LIKE_COMMENT_MUTATION,
  REPORT_COMMENT_MUTATION,
  UNLIKE_COMMENT_MUTATION,
} from "../queries.js";
import { listFromPages, pagedByLastId } from "../paging.js";
import { expectField } from "../op-utils.js";
import { NotFoundError } from "../errors.js";
import type { CommentResult, CommentWriteResult, CommentsOptions, ListOptions, PostRef } from "../op-types.js";

const DEFAULT_COMMENTS_LIMIT = 15;
const DEFAULT_REPLIES_LIMIT = 3;

/** Resolve a comment-page pagination object; the cursor key is omitted when
 * unset (no nested null in the payload). */
function paginationOf(limit: number, cursor?: number | null): { limit: number; cursor?: number } {
  return cursor === null || cursor === undefined ? { limit } : { limit, cursor };
}

async function commentsPage(client: ScrolllerClient, postId: number, limit: number, cursor?: number | null): Promise<CommentResult[]> {
  const data = await client.request(GET_COMMENTS_QUERY, {
    post_id: postId,
    pagination: paginationOf(limit, cursor),
  });
  return expectField<CommentResult[]>(data, "getComments");
}

async function resolveRefToPostId(client: ScrolllerClient, ref: PostRef): Promise<number> {
  if (typeof ref === "number") return ref;
  const trimmed = ref.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const link = await client.resolveLink(trimmed);
  const id = link?.post?.id;
  const parsed = typeof id === "number" ? id : typeof id === "string" ? Number(id) : NaN;
  if (!Number.isInteger(parsed)) {
    throw new NotFoundError(`cannot resolve post id from ref ${JSON.stringify(ref)}`);
  }
  return parsed;
}

async function getComments(this: ScrolllerClient, ref: PostRef, options: CommentsOptions = {}): Promise<CommentResult[]> {
  const postId = await resolveRefToPostId(this, ref);
  return commentsPage(this, postId, options.limit ?? DEFAULT_COMMENTS_LIMIT, options.cursor);
}

async function* getCommentsPages(this: ScrolllerClient, ref: PostRef, options: CommentsOptions = {}): AsyncGenerator<CommentResult[]> {
  const postId = await resolveRefToPostId(this, ref);
  const limit = options.limit ?? DEFAULT_COMMENTS_LIMIT;
  yield* pagedByLastId<CommentResult>((cursor) => commentsPage(this, postId, limit, cursor), limit);
}

async function listComments(this: ScrolllerClient, ref: PostRef, options: CommentsOptions & ListOptions = {}): Promise<CommentResult[]> {
  return listFromPages(this.getCommentsPages(ref, options), options.limit);
}

async function repliesPage(client: ScrolllerClient, commentId: number, limit: number, cursor?: number | null): Promise<CommentResult[]> {
  const data = await client.request(GET_REPLIES_FROM_COMMENT_QUERY, {
    comment_id: commentId,
    pagination: paginationOf(limit, cursor),
  });
  return expectField<CommentResult[]>(data, "getRepliesFromComment");
}

async function getRepliesFromComment(this: ScrolllerClient, commentId: number, options: CommentsOptions = {}): Promise<CommentResult[]> {
  return repliesPage(this, commentId, options.limit ?? DEFAULT_REPLIES_LIMIT, options.cursor);
}

async function* getRepliesFromCommentPages(this: ScrolllerClient, commentId: number, options: CommentsOptions = {}): AsyncGenerator<CommentResult[]> {
  const limit = options.limit ?? DEFAULT_REPLIES_LIMIT;
  yield* pagedByLastId<CommentResult>((cursor) => repliesPage(this, commentId, limit, cursor), limit);
}

async function listRepliesFromComment(this: ScrolllerClient, commentId: number, options: CommentsOptions & ListOptions = {}): Promise<CommentResult[]> {
  return listFromPages(this.getRepliesFromCommentPages(commentId, options), options.limit);
}

async function createComment(this: ScrolllerClient, ref: PostRef, content: string): Promise<CommentWriteResult> {
  this.requireAuth();
  const postId = await resolveRefToPostId(this, ref);
  const data = await this.requestMutation(CREATE_COMMENT_MUTATION, { content, post_id: postId });
  return expectField<CommentWriteResult>(data, "createComment");
}

async function createCommentReply(this: ScrolllerClient, content: string, parentCommentId: number): Promise<CommentWriteResult> {
  this.requireAuth();
  const data = await this.requestMutation(CREATE_COMMENT_REPLY_MUTATION, { content, parent_comment_id: parentCommentId });
  return expectField<CommentWriteResult>(data, "createCommentReply");
}

async function likeComment(this: ScrolllerClient, commentId: number): Promise<boolean> {
  this.requireAuth();
  const data = await this.requestMutation(LIKE_COMMENT_MUTATION, { id: commentId });
  return expectField<boolean>(data, "likeComment");
}

async function unlikeComment(this: ScrolllerClient, commentId: number): Promise<boolean> {
  this.requireAuth();
  const data = await this.requestMutation(UNLIKE_COMMENT_MUTATION, { id: commentId });
  return expectField<boolean>(data, "unlikeComment");
}

async function deleteComment(this: ScrolllerClient, commentId: number): Promise<CommentWriteResult> {
  this.requireAuth();
  const data = await this.requestMutation(DELETE_COMMENT_MUTATION, { id: commentId });
  return expectField<CommentWriteResult>(data, "deleteComment");
}

async function reportComment(this: ScrolllerClient, commentId: number, reason: string, details?: string): Promise<boolean> {
  this.requireAuth();
  const data = await this.requestMutation(REPORT_COMMENT_MUTATION, { commentId, reason, details });
  return expectField<boolean>(data, "reportComment");
}

ScrolllerClient.prototype.getComments = getComments;
ScrolllerClient.prototype.getCommentsPages = getCommentsPages;
ScrolllerClient.prototype.listComments = listComments;
ScrolllerClient.prototype.getRepliesFromComment = getRepliesFromComment;
ScrolllerClient.prototype.getRepliesFromCommentPages = getRepliesFromCommentPages;
ScrolllerClient.prototype.listRepliesFromComment = listRepliesFromComment;
ScrolllerClient.prototype.createComment = createComment;
ScrolllerClient.prototype.createCommentReply = createCommentReply;
ScrolllerClient.prototype.likeComment = likeComment;
ScrolllerClient.prototype.unlikeComment = unlikeComment;
ScrolllerClient.prototype.deleteComment = deleteComment;
ScrolllerClient.prototype.reportComment = reportComment;

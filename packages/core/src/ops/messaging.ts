/** Notifications + direct messages (CONTRACT.md §6 rows 17–18). All 🔒 —
 * fail-fast AUTH_REQUIRED (CONTRACT.md §5.1); T1 §2 lists both families behind
 * the logged-in gate.
 *
 * Pagination (T1 §6): notifications/messages use numeric `page`; conversations
 * use the opaque `next_cursor`.
 */
import { ScrolllerClient } from "../client.js";
import {
  GET_CONVERSATIONS_QUERY,
  GET_MESSAGES_QUERY,
  GET_TOTAL_UNREAD_COUNT_QUERY,
  MARK_ALL_NOTIFICATIONS_AS_READ_MUTATION,
  MARK_MESSAGES_AS_READ_MUTATION,
  MARK_NOTIFICATION_AS_ARCHIVED_MUTATION,
  MARK_NOTIFICATION_AS_UNARCHIVED_MUTATION,
  NOTIFICATIONS_QUERY,
  SEND_MESSAGE_MUTATION,
} from "../queries.js";
import { isExhaustedCursor, listFromPages, pagedByPageNumber } from "../paging.js";
import { expectField } from "../op-utils.js";
import type {
  ConversationResult,
  ConversationsOptions,
  ConversationsPage,
  ListOptions,
  MessageResult,
  MessagesOptions,
  MessagesPage,
  NotificationResult,
  NotificationsOptions,
} from "../op-types.js";

const DEFAULT_NOTIFICATIONS_LIMIT = 30; // site default (T1 §3g)
const DEFAULT_CONVERSATIONS_LIMIT = 20; // site default (T1 §6)
const DEFAULT_MESSAGES_LIMIT = 20;

async function notifications(this: ScrolllerClient, options: NotificationsOptions = {}): Promise<NotificationResult[]> {
  this.requireAuth();
  return notificationsPage(this, options.page ?? 1, options.limit ?? DEFAULT_NOTIFICATIONS_LIMIT, options.filter);
}

async function notificationsPage(
  client: ScrolllerClient,
  page: number,
  limit: number,
  filter?: "ALL" | "ARCHIVED",
): Promise<NotificationResult[]> {
  const data: GetNotificationsInput = {
    pagination: { page, limit },
  };
  if (filter !== undefined) data.filter = filter;
  const response = await client.request(NOTIFICATIONS_QUERY, { data });
  return expectField<NotificationResult[]>(response, "getNotifications");
}

interface GetNotificationsInput {
  pagination: { page: number; limit: number };
  /** Bundle-inferred input field (T1 §4: "Notifications filter: ALL | ARCHIVED"). */
  filter?: "ALL" | "ARCHIVED";
}

async function* notificationsPages(this: ScrolllerClient, options: NotificationsOptions = {}): AsyncGenerator<NotificationResult[]> {
  this.requireAuth();
  const limit = options.limit ?? DEFAULT_NOTIFICATIONS_LIMIT;
  yield* pagedByPageNumber<NotificationResult>(
    (page) => notificationsPage(this, page, limit, options.filter),
    limit,
    options.page ?? 1,
  );
}

async function listNotifications(this: ScrolllerClient, options: NotificationsOptions & ListOptions = {}): Promise<NotificationResult[]> {
  return listFromPages(this.notificationsPages(options), options.limit);
}

async function markAllNotificationsAsRead(this: ScrolllerClient): Promise<boolean> {
  this.requireAuth();
  const data = await this.requestMutation(MARK_ALL_NOTIFICATIONS_AS_READ_MUTATION);
  return expectField<boolean>(data, "markAllNotificationsAsRead");
}

async function markNotificationAsArchived(this: ScrolllerClient, id: number): Promise<boolean> {
  this.requireAuth();
  const data = await this.requestMutation(MARK_NOTIFICATION_AS_ARCHIVED_MUTATION, { id });
  return expectField<boolean>(data, "markNotificationAsArchived");
}

async function markNotificationAsUnarchived(this: ScrolllerClient, id: number): Promise<boolean> {
  this.requireAuth();
  const data = await this.requestMutation(MARK_NOTIFICATION_AS_UNARCHIVED_MUTATION, { id });
  return expectField<boolean>(data, "markNotificationAsUnarchived");
}

async function conversationsPage(client: ScrolllerClient, limit: number, cursor?: string | null): Promise<ConversationsPage> {
  const data: Record<string, unknown> = { limit };
  if (!isExhaustedCursor(cursor) && cursor) data.cursor = cursor;
  const response = await client.request(GET_CONVERSATIONS_QUERY, { data });
  return expectField<ConversationsPage>(response, "getConversations");
}

async function conversations(this: ScrolllerClient, options: ConversationsOptions = {}): Promise<ConversationsPage> {
  this.requireAuth();
  return conversationsPage(this, options.limit ?? DEFAULT_CONVERSATIONS_LIMIT, options.cursor);
}

async function* conversationsPages(this: ScrolllerClient, options: ConversationsOptions = {}): AsyncGenerator<ConversationsPage> {
  this.requireAuth();
  const limit = options.limit ?? DEFAULT_CONVERSATIONS_LIMIT;
  let cursor = options.cursor ?? null;
  for (;;) {
    const page = await conversationsPage(this, limit, cursor);
    yield page;
    const next = page.next_cursor ?? null;
    if (isExhaustedCursor(next)) return;
    cursor = next;
  }
}

async function listConversations(this: ScrolllerClient, options: ConversationsOptions & ListOptions = {}): Promise<ConversationResult[]> {
  return listFromPages(
    mapConversationPages(this.conversationsPages(options)),
    options.limit,
  );
}

async function* mapConversationPages(pages: AsyncGenerator<ConversationsPage>): AsyncGenerator<ConversationResult[]> {
  for await (const page of pages) {
    yield page.items ?? [];
  }
}

/** Accept a conversation object (from getConversations) or a bare other-user id. */
function conversationUserId(conversation: number | ConversationResult): number {
  if (typeof conversation === "number") return conversation;
  const id = conversation.user?.id;
  const parsed = typeof id === "number" ? id : typeof id === "string" ? Number(id) : NaN;
  if (!Number.isInteger(parsed)) {
    throw new Error("conversation has no numeric user id; pass the other user's id directly");
  }
  return parsed;
}

async function messagesPage(client: ScrolllerClient, otherUserId: number, limit: number, page: number): Promise<MessagesPage> {
  const response = await client.request(GET_MESSAGES_QUERY, {
    data: { other_user_id: otherUserId, limit, page },
  });
  return expectField<MessagesPage>(response, "getMessages");
}

async function messages(this: ScrolllerClient, conversation: number | ConversationResult, options: MessagesOptions = {}): Promise<MessagesPage> {
  this.requireAuth();
  return messagesPage(this, conversationUserId(conversation), options.limit ?? DEFAULT_MESSAGES_LIMIT, options.page ?? 1);
}

async function* messagesPages(this: ScrolllerClient, conversation: number | ConversationResult, options: MessagesOptions = {}): AsyncGenerator<MessagesPage> {
  this.requireAuth();
  const userId = conversationUserId(conversation);
  const limit = options.limit ?? DEFAULT_MESSAGES_LIMIT;
  let page = options.page ?? 1;
  for (;;) {
    const result = await messagesPage(this, userId, limit, page);
    yield result;
    const items = result.items ?? [];
    const total = typeof result.total === "number" ? result.total : null;
    if (items.length === 0 || items.length < limit) return;
    if (total !== null && page * limit >= total) return;
    page += 1;
  }
}

async function listMessages(this: ScrolllerClient, conversation: number | ConversationResult, options: MessagesOptions & ListOptions = {}): Promise<MessageResult[]> {
  const collected: MessageResult[] = [];
  for await (const result of this.messagesPages(conversation, options)) {
    collected.push(...(result.items ?? []));
    if (options.limit != null && collected.length >= options.limit) {
      return collected.slice(0, options.limit);
    }
  }
  return collected;
}

async function sendMessage(this: ScrolllerClient, receiverId: number, content: string): Promise<MessageResult> {
  this.requireAuth();
  const data = await this.requestMutation(SEND_MESSAGE_MUTATION, { data: { receiver_id: receiverId, content } });
  return expectField<MessageResult>(data, "sendMessage");
}

async function markMessagesAsRead(this: ScrolllerClient, senderId: number): Promise<boolean> {
  this.requireAuth();
  const data = await this.requestMutation(MARK_MESSAGES_AS_READ_MUTATION, { sender_id: senderId });
  return expectField<boolean>(data, "markMessagesAsRead");
}

async function totalUnreadCount(this: ScrolllerClient): Promise<number | null> {
  this.requireAuth();
  const data = await this.request(GET_TOTAL_UNREAD_COUNT_QUERY);
  return expectField<number | null>(data, "getTotalUnreadCount");
}

ScrolllerClient.prototype.notifications = notifications;
ScrolllerClient.prototype.notificationsPages = notificationsPages;
ScrolllerClient.prototype.listNotifications = listNotifications;
ScrolllerClient.prototype.markAllNotificationsAsRead = markAllNotificationsAsRead;
ScrolllerClient.prototype.markNotificationAsArchived = markNotificationAsArchived;
ScrolllerClient.prototype.markNotificationAsUnarchived = markNotificationAsUnarchived;
ScrolllerClient.prototype.conversations = conversations;
ScrolllerClient.prototype.conversationsPages = conversationsPages;
ScrolllerClient.prototype.listConversations = listConversations;
ScrolllerClient.prototype.messages = messages;
ScrolllerClient.prototype.messagesPages = messagesPages;
ScrolllerClient.prototype.listMessages = listMessages;
ScrolllerClient.prototype.sendMessage = sendMessage;
ScrolllerClient.prototype.markMessagesAsRead = markMessagesAsRead;
ScrolllerClient.prototype.totalUnreadCount = totalUnreadCount;

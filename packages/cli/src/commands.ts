/** Full CLI command tree (CONTRACT.md §6 CLI column) — one command per core
 * method, output via output.ts, errors via errors.ts (§5.1 auth UX).
 */
import type { Command } from "commander";
import {
  asProxyConfig,
  isNumericId,
  NotFoundError,
  proxyConfigToDict,
  ScrolllerClient,
  updateConfigFile,
  type CollectionMutationOptions,
  type CollectionResult,
  type ConversationsPage,
  type DiscoverResult,
  type HideRuleWithUrlResult,
  type MessageResult,
  type NotificationResult,
  type PostResult,
  type ProxyConfig,
  type ResolvedLinkResult,
  type SearchSubredditPreviewResult,
  type SearchSubredditResult,
  type SubredditFeedPage,
} from "scrolller-core";
import { buildContext, coerceFilter, coerceIntOption, coerceSortBy, normalizeRefArg, toAbsoluteScrolllerUrl, type Context } from "./context.js";
import { runAction, UsageError } from "./errors.js";
import { collectQueryPosts, printDownloadResults, ProgressRenderer, runDownload } from "./download-run.js";
import {
  fmtCount,
  printCollection,
  printComments,
  printJson,
  printKeyValue,
  printPost,
  printPostListItem,
  printSubredditCards,
  subredditRow,
} from "./output.js";
import { LOGIN_TTY_GUIDANCE, promptConfirm, promptCredentials, promptProxyConfig } from "./prompts.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface ActionOptions {
  limit?: string;
  childLimit?: string;
  sortBy?: string;
  filter?: string;
  iterator?: string;
  includeFilters?: string;
  excludeFilters?: string;
  pageIndex?: string;
  cursor?: string;
  page?: string;
  description?: string;
  private?: boolean;
  nsfw?: boolean;
  reddit?: boolean;
  out?: string;
  count?: string;
  concurrency?: string;
  format?: string;
  test?: boolean;
  clear?: boolean;
  verbose?: boolean;
  [key: string]: unknown;
}

function contextOf(cmd: Command): Context {
  const globals = cmd.optsWithGlobals() as Parameters<typeof buildContext>[0];
  return buildContext(globals);
}

function limitOf(options: ActionOptions): number | undefined {
  return options.limit !== undefined ? coerceIntOption(options.limit, "limit") : undefined;
}

function pageIndexOf(options: ActionOptions): number | undefined {
  return options.pageIndex !== undefined ? coerceIntOption(options.pageIndex, "page-index", 0) : undefined;
}

function pageOf(options: ActionOptions): number | undefined {
  return options.page !== undefined ? coerceIntOption(options.page, "page", 0) : undefined;
}

function idArgument(value: string, name: string): number {
  if (!isNumericId(value)) {
    throw new UsageError(`${name} must be a numeric id, got ${JSON.stringify(value)}`);
  }
  return Number(value);
}

function filtersOf(options: ActionOptions): { includeFilters?: number[]; excludeFilters?: number[] } {
  const parse = (raw: string | undefined, name: string): number[] | undefined => {
    if (raw === undefined) return undefined;
    const ids = raw.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
    if (ids.length === 0) return undefined;
    return ids.map((id) => {
      if (!isNumericId(id)) throw new UsageError(`--${name} expects numeric category ids, got ${JSON.stringify(id)}`);
      return Number(id);
    });
  };
  return { includeFilters: parse(options.includeFilters, "include-filters"), excludeFilters: parse(options.excludeFilters, "exclude-filters") };
}

/** Resolve a bare numeric id, post URL, or redditPath to a numeric post id. */
async function resolvePostId(client: ScrolllerClient, ref: string): Promise<number> {
  if (isNumericId(ref)) return Number(ref);
  const link = await client.resolveLink(toAbsoluteScrolllerUrl(ref));
  const id = link?.post?.id;
  const parsed = typeof id === "number" ? id : typeof id === "string" ? Number(id) : NaN;
  if (!Number.isInteger(parsed)) {
    throw new NotFoundError(`cannot resolve a post id from ${JSON.stringify(ref)}`);
  }
  return parsed;
}

/** A post URL / redditPath (getPost input) vs. a free-text query. */
function looksLikePostRef(ref: string): boolean {
  return ref.startsWith("http://") || ref.startsWith("https://") || ref.includes("/r/") || ref.startsWith("/");
}

function collectionMutationOptions(options: ActionOptions): CollectionMutationOptions {
  return {
    description: options.description,
    isPrivate: options.private,
    isNsfw: options.nsfw,
  };
}

async function printBool(context: Context, verb: string, url: string, body: () => Promise<boolean>): Promise<void> {
  const result = await body();
  if (context.json) {
    printJson(result, context.verbose);
    return;
  }
  console.log(result ? `${verb} ${url}` : `${verb} ${url} (server returned false)`);
}

// ---------------------------------------------------------------------------
// Human formatters for the less trivial result shapes
// ---------------------------------------------------------------------------

function printDiscover(feed: DiscoverResult): void {
  printSubredditCards(feed.items.map(subredditRow));
  if (feed.iterator) {
    console.log(`next iterator: ${feed.iterator}`);
  }
}

function printSearchPreviews(items: SearchSubredditPreviewResult[]): void {
  printSubredditCards(items.map((item) => ({
    title: item.title ?? null,
    url: item.url ?? null,
    itemCount: item.itemCount ?? null,
    subscribers: null,
    isNsfw: item.isNsfw ?? null,
  })));
}

function printSearchSubreddits(items: SearchSubredditResult[]): void {
  printSubredditCards(items.map((item) => ({
    title: item.title ?? null,
    url: item.url ?? null,
    itemCount: item.item_count ?? null,
    subscribers: null,
    isNsfw: item.is_nsfw ?? null,
  })));
}

function printSubredditFeed(page: SubredditFeedPage): void {
  const sub = page.subreddit;
  if (sub) {
    printSubredditCards([subredditRow(sub)]);
    if (sub.description) console.log(`  ${sub.description}`);
  }
  console.log(`posts on page: ${page.items.length}`);
  page.items.forEach((post, index) => printPostListItem(index + 1, post));
  if (page.iterator) {
    console.log(`next iterator: ${page.iterator}`);
  }
}

function printResolved(link: ResolvedLinkResult): void {
  const kind = link.type ?? (link.post ? "post" : link.subreddit ? "subreddit" : link.collection ? "collection" : "unknown");
  const fields: Array<[string, unknown]> = [["type", kind], ["url", link.url ?? null]];
  if (link.post) {
    fields.push(["post id", link.post.id], ["post title", link.post.title], ["subreddit", link.post.subredditUrl]);
  } else if (link.subreddit) {
    fields.push(["subreddit id", link.subreddit.id], ["title", link.subreddit.title], ["nsfw", link.subreddit.isNsfw]);
  } else if (link.collection) {
    fields.push(["collection id", link.collection.id], ["title", link.collection.title], ["items", link.collection.item_count]);
  }
  printKeyValue("resolved", fields);
}

function printNotifications(items: NotificationResult[]): void {
  if (items.length === 0) {
    console.log("no notifications");
    return;
  }
  for (const item of items) {
    const bits = [
      `id=${item.id ?? "?"}`,
      item.title ?? "",
      item.createdAt ?? "",
      item.archivedAt ? "archived" : item.viewedAt ? "read" : "unread",
    ];
    console.log(bits.filter(Boolean).join("  ·  "));
    if (item.content) console.log(`    ${item.content}`);
  }
}

function printConversations(page: ConversationsPage): void {
  const items = page.items ?? [];
  if (items.length === 0) {
    console.log("no conversations");
    return;
  }
  for (const conversation of items) {
    const name = conversation.user?.username ?? conversation.user?.id ?? "?";
    const unread = conversation.unread_count ? `unread=${conversation.unread_count}` : "read";
    const last = conversation.last_message ? `${conversation.last_message.sender?.username ?? "?"}: ${conversation.last_message.content ?? ""}` : "";
    console.log(`${name}  ·  ${unread}${last ? `  ·  ${last}` : ""}`);
  }
}

function printMessages(items: MessageResult[]): void {
  if (items.length === 0) {
    console.log("no messages");
    return;
  }
  for (const message of items) {
    const sender = message.sender?.username ?? message.sender_id ?? "?";
    console.log(`${sender}  ·  ${message.created_at ?? ""}  ·  id=${message.id ?? "?"}`);
    console.log(`    ${message.content ?? ""}`);
  }
}

function printHideRules(rules: HideRuleWithUrlResult[]): void {
  if (rules.length === 0) {
    console.log("no hide rules");
    return;
  }
  for (const rule of rules) {
    console.log(`${rule.contentType ?? "?"}  ·  id=${rule.id ?? "?"}  ·  target=${rule.targetId ?? "?"}  ·  ${rule.url ?? ""}${rule.subredditTitle ? ` (${rule.subredditTitle})` : ""}  ·  ${rule.createdAt ?? ""}`);
  }
}

function printCollections(collections: CollectionResult[]): void {
  if (collections.length === 0) {
    console.log("no collections");
    return;
  }
  for (const collection of collections) {
    const bits = [`id=${collection.id ?? "?"}`, collection.title ?? "", `items=${fmtCount(collection.item_count)}`];
    if (collection.is_private) bits.push("private");
    if (collection.is_nsfw) bits.push("NSFW");
    console.log(bits.join("  ·  "));
  }
}

function printUserPosts(username: string, posts: PostResult[]): void {
  console.log(`posts by ${username}: ${posts.length}`);
  posts.forEach((post, index) => printPostListItem(index + 1, post));
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerCommands(program: Command): void {
  // -- Public reads ----------------------------------------------------------

  program
    .command("discover")
    .description("discover feed (subreddit cards)")
    .option("--limit <n>", "subreddit cards per page")
    .option("--child-limit <n>", "posts embedded per card")
    .option("--sort-by <sortBy>", "RANDOM | TOP | HOT | NEW | CONTROVERSIAL")
    .option("--filter <filter>", "CATEGORY | SUBREDDIT | ALBUM | VIDEO | PICTURE | SOUND")
    .option("--iterator <iterator>", "resume a previous page (byte-exact cursor)")
    .option("--include-filters <ids>", "category ids to include (comma-separated)")
    .option("--exclude-filters <ids>", "category ids to exclude (comma-separated)")
    .action(async (options: ActionOptions, cmd: Command) => {
      const context = contextOf(cmd);
      await runAction(context, async () => {
        const { includeFilters, excludeFilters } = filtersOf(options);
        const feed = await context.client.discover({
          limit: options.limit !== undefined ? coerceIntOption(options.limit, "limit") : undefined,
          childLimit: options.childLimit !== undefined ? coerceIntOption(options.childLimit, "child-limit") : undefined,
          sortBy: coerceSortBy(options.sortBy),
          filter: coerceFilter(options.filter),
          iterator: options.iterator,
          includeFilters,
          excludeFilters,
        });
        if (context.json) printJson(feed, context.verbose);
        else printDiscover(feed);
      });
    });

  program
    .command("search <query>")
    .description("search subreddits (site search page; no per-post media search exists server-side)")
    .option("--limit <n>", "results per page")
    .option("--page-index <n>", "result page (0-based)")
    .action(async (query: string, options: ActionOptions, cmd: Command) => {
      const context = contextOf(cmd);
      await runAction(context, async () => {
        const results = await context.client.searchSubredditWithPreview(query, {
          limit: limitOf(options),
          pageIndex: pageIndexOf(options),
        });
        if (context.json) printJson(results, context.verbose);
        else printSearchPreviews(results);
      });
    });

  program
    .command("subreddit <name>")
    .description("subreddit feed (card + posts)")
    .option("--limit <n>", "posts per page")
    .option("--sort-by <sortBy>", "RANDOM | TOP | HOT | NEW | CONTROVERSIAL")
    .option("--filter <filter>", "CATEGORY | SUBREDDIT | ALBUM | VIDEO | PICTURE | SOUND")
    .action(async (name: string, options: ActionOptions, cmd: Command) => {
      name = normalizeRefArg(name);
      const context = contextOf(cmd);
      await runAction(context, async () => {
        const page = await context.client.subredditFeed(name, {
          limit: limitOf(options),
          sortBy: coerceSortBy(options.sortBy),
          filter: coerceFilter(options.filter),
        });
        if (context.json) printJson(page, context.verbose);
        else printSubredditFeed(page);
      });
    });

  program
    .command("subreddit-search <query>")
    .description("subreddit autocomplete search")
    .option("--limit <n>", "results per page")
    .option("--page-index <n>", "result page (0-based)")
    .action(async (query: string, options: ActionOptions, cmd: Command) => {
      const context = contextOf(cmd);
      await runAction(context, async () => {
        const results = await context.client.searchSubreddits(query, {
          limit: limitOf(options),
          pageIndex: pageIndexOf(options),
        });
        if (context.json) printJson(results, context.verbose);
        else printSearchSubreddits(results);
      });
    });

  program
    .command("post <url>")
    .description("post details by scrolller URL")
    .action(async (url: string, _options: ActionOptions, cmd: Command) => {
      url = normalizeRefArg(url);
      const context = contextOf(cmd);
      await runAction(context, async () => {
        const post = await context.client.getPost(url);
        if (post === null || post === undefined) {
          throw new NotFoundError(`server returned no post for ${JSON.stringify(url)} (the API can soft-null under rapid requests — retry shortly)`);
        }
        if (context.json) printJson(post, context.verbose);
        else printPost(post);
      });
    });

  program
    .command("comments <url>")
    .description("top-level comments of a post")
    .option("--limit <n>", "comments per page")
    .option("--cursor <id>", "last comment id of the previous page")
    .action(async (url: string, options: ActionOptions, cmd: Command) => {
      url = toAbsoluteScrolllerUrl(normalizeRefArg(url));
      const context = contextOf(cmd);
      await runAction(context, async () => {
        const comments = await context.client.getComments(url, {
          limit: limitOf(options),
          cursor: options.cursor !== undefined ? idArgument(options.cursor, "--cursor") : undefined,
        });
        if (context.json) printJson(comments, context.verbose);
        else printComments(comments);
      });
    });

  // -- Comments (write) -------------------------------------------------------

  program
    .command("comment <url> <text>")
    .description("add a comment to a post (auth required)")
    .action(async (url: string, text: string, _options: ActionOptions, cmd: Command) => {
      url = toAbsoluteScrolllerUrl(normalizeRefArg(url));
      const context = contextOf(cmd);
      await runAction(context, async () => {
        const result = await context.client.createComment(url, text);
        if (context.json) printJson(result, context.verbose);
        else console.log(`comment created: id=${result.id ?? "?"} (post comments: ${result.postCommentsCount ?? "?"})`);
      });
    });

  program
    .command("comment-reply <comment-id> <text>")
    .description("reply to a comment (auth required)")
    .action(async (commentId: string, text: string, _options: ActionOptions, cmd: Command) => {
      const context = contextOf(cmd);
      await runAction(context, async () => {
        const result = await context.client.createCommentReply(text, idArgument(commentId, "comment-id"));
        if (context.json) printJson(result, context.verbose);
        else console.log(`reply created: id=${result.id ?? "?"} (comment replies: ${result.postCommentsRepliesCount ?? "?"})`);
      });
    });

  program
    .command("comment-like <comment-id>")
    .description("like a comment (auth required)")
    .action(async (commentId: string, _options: ActionOptions, cmd: Command) => {
      const context = contextOf(cmd);
      await runAction(context, async () => {
        const result = await context.client.likeComment(idArgument(commentId, "comment-id"));
        if (context.json) printJson(result, context.verbose);
        else console.log(result ? `comment ${commentId} liked` : `comment ${commentId} like returned false`);
      });
    });

  program
    .command("comment-delete <comment-id>")
    .description("delete your comment (auth required)")
    .action(async (commentId: string, _options: ActionOptions, cmd: Command) => {
      const context = contextOf(cmd);
      await runAction(context, async () => {
        const result = await context.client.deleteComment(idArgument(commentId, "comment-id"));
        if (context.json) printJson(result, context.verbose);
        else console.log(`comment ${commentId} deleted (post comments: ${result.postCommentsCount ?? "?"})`);
      });
    });

  // -- Social (likes/reposts/follow) ------------------------------------------

  const boolCommands: Array<[string, string, (client: ScrolllerClient, url: string) => Promise<boolean>, string]> = [
    ["like", "like a post (auth required)", (client, url) => client.like(url), "liked"],
    ["unlike", "remove a like (auth required)", (client, url) => client.unlike(url), "unliked"],
    ["repost", "repost a post (auth required)", (client, url) => client.repost(url), "reposted"],
    ["unrepost", "remove a repost (auth required)", (client, url) => client.unrepost(url), "unreposted"],
    ["follow", "follow a subreddit/user URL (auth required)", (client, url) => client.follow(url), "followed"],
    ["unfollow", "unfollow a subreddit/user URL (auth required)", (client, url) => client.unfollow(url), "unfollowed"],
  ];
  for (const [name, description, call, verb] of boolCommands) {
    program
      .command(`${name} <url>`)
      .description(description)
      .action(async (url: string, _options: ActionOptions, cmd: Command) => {
        url = normalizeRefArg(url);
        const context = contextOf(cmd);
        await runAction(context, () => printBool(context, verb, url, () => call(context.client, url)));
      });
  }

  // -- Account ----------------------------------------------------------------

  program
    .command("whoami")
    .description("logged-in user profile (auth required)")
    .action(async (_options: ActionOptions, cmd: Command) => {
      const context = contextOf(cmd);
      await runAction(context, async () => {
        const me = await context.client.me();
        if (context.json) printJson(me, context.verbose);
        else {
          printKeyValue("me", [
            ["username", me.username],
            ["id", me.id],
            ["email", me.email],
            ["premium", me.isPremium],
            ["premium ends", me.premium_ends],
            ["created", me.created_at],
          ]);
        }
      });
    });

  program
    .command("login [username] [password]")
    .description("login (interactive prompts; or pass username and password)")
    .action(async (username: string | undefined, password: string | undefined, _options: ActionOptions, cmd: Command) => {
      const context = contextOf(cmd);
      await runAction(context, async () => {
        let credentials: { username: string; password: string };
        if (username !== undefined && password !== undefined) {
          credentials = { username, password };
        } else if (username === undefined && password === undefined && process.stdin.isTTY) {
          credentials = await promptCredentials();
        } else {
          console.error("login: pass both username and password for non-interactive login, or run inside a TTY for prompts.");
          console.error(LOGIN_TTY_GUIDANCE);
          process.exit(1);
        }
        const result = await context.client.login(credentials.username, credentials.password);
        const masked = { ...result, token: result.token ? "***" : null };
        if (context.json) {
          printJson(masked, context.verbose);
        } else {
          console.log(`Logged in as ${result.username ?? credentials.username}${result.isPremium ? " (premium)" : ""}.`);
          console.log(`Token saved to ${context.client.config.configPath}`);
        }
      });
    });

  program
    .command("token <token>")
    .description("store an auth token manually (persisted to config)")
    .action(async (token: string, _options: ActionOptions, cmd: Command) => {
      const context = contextOf(cmd);
      await runAction(context, async () => {
        context.client.setToken(token);
        if (context.json) printJson({ saved: true, config_path: context.client.config.configPath }, context.verbose);
        else console.log(`Token saved to ${context.client.config.configPath}`);
      });
    });

  program
    .command("logout")
    .description("clear the stored token")
    .action(async (_options: ActionOptions, cmd: Command) => {
      const context = contextOf(cmd);
      await runAction(context, async () => {
        context.client.logout();
        if (context.json) printJson({ logged_out: true }, context.verbose);
        else console.log("Logged out (token cleared).");
      });
    });

  // -- Collections -------------------------------------------------------------

  const collection = program
    .command("collection")
    .description("collection management (auth required unless noted)");

  collection
    .command("list")
    .description("list your collections")
    .action(async (_options: ActionOptions, cmd: Command) => {
      const context = contextOf(cmd);
      await runAction(context, async () => {
        const collections = await context.client.collections();
        if (context.json) printJson(collections, context.verbose);
        else printCollections(collections);
      });
    });

  collection
    .command("get <id>")
    .description("collection details by id")
    .action(async (id: string, _options: ActionOptions, cmd: Command) => {
      const context = contextOf(cmd);
      await runAction(context, async () => {
        const result = await context.client.collection(idArgument(id, "collection id"));
        if (result === null || result === undefined) {
          throw new NotFoundError(`server returned no collection for id ${id}`);
        }
        if (context.json) printJson(result, context.verbose);
        else printCollection(result);
      });
    });

  collection
    .command("create <title>")
    .description("create a collection")
    .option("--description <text>", "collection description")
    .option("--private", "mark the collection private")
    .option("--nsfw", "mark the collection NSFW")
    .action(async (title: string, options: ActionOptions, cmd: Command) => {
      const context = contextOf(cmd);
      await runAction(context, async () => {
        const created = await context.client.createCollection(title, collectionMutationOptions(options));
        if (context.json) printJson(created, context.verbose);
        else printCollection(created);
      });
    });

  collection
    .command("add <post-ref> <collection-id>")
    .description("add a post (scrolller URL or numeric id) to a collection")
    .action(async (postRef: string, collectionId: string, _options: ActionOptions, cmd: Command) => {
      postRef = normalizeRefArg(postRef);
      const context = contextOf(cmd);
      await runAction(context, async () => {
        const postId = await resolvePostId(context.client, postRef);
        const result = await context.client.collectionAddPost(postId, idArgument(collectionId, "collection id"));
        if (context.json) printJson(result, context.verbose);
        else console.log(result ? `Post ${postId} added to collection ${collectionId}` : "Server returned false (add)");
      });
    });

  collection
    .command("remove <post-ref> <collection-id>")
    .description("remove a post (scrolller URL or numeric id) from a collection")
    .action(async (postRef: string, collectionId: string, _options: ActionOptions, cmd: Command) => {
      postRef = normalizeRefArg(postRef);
      const context = contextOf(cmd);
      await runAction(context, async () => {
        const postId = await resolvePostId(context.client, postRef);
        const result = await context.client.collectionRemovePost(postId, idArgument(collectionId, "collection id"));
        if (context.json) printJson(result, context.verbose);
        else console.log(result ? `Post ${postId} removed from collection ${collectionId}` : "Server returned false (remove)");
      });
    });

  collection
    .command("edit <id> <new-title>")
    .description("rename / edit a collection")
    .option("--description <text>", "collection description")
    .option("--private <bool>", "private flag (true/false)")
    .option("--nsfw <bool>", "NSFW flag (true/false)")
    .action(async (id: string, newTitle: string, options: ActionOptions, cmd: Command) => {
      const context = contextOf(cmd);
      await runAction(context, async () => {
        const parseBoolOption = (raw: string | undefined, name: string): boolean | undefined => {
          if (raw === undefined) return undefined;
          if (raw === "true") return true;
          if (raw === "false") return false;
          throw new UsageError(`--${name} expects true or false, got ${JSON.stringify(raw)}`);
        };
        const edited = await context.client.editCollection(idArgument(id, "collection id"), newTitle, {
          description: options.description,
          isPrivate: parseBoolOption(options.private as unknown as string | undefined, "private"),
          isNsfw: parseBoolOption(options.nsfw as unknown as string | undefined, "nsfw"),
        });
        if (context.json) printJson(edited, context.verbose);
        else printCollection(edited);
      });
    });

  collection
    .command("delete <id>")
    .description("delete a collection")
    .action(async (id: string, _options: ActionOptions, cmd: Command) => {
      const context = contextOf(cmd);
      await runAction(context, async () => {
        const result = await context.client.deleteCollection(idArgument(id, "collection id"));
        if (context.json) printJson(result, context.verbose);
        else console.log(result ? `Collection ${id} deleted` : `Server returned false for delete (collection ${id})`);
      });
    });

  // -- Notifications -----------------------------------------------------------

  program
    .command("notifications [action] [id]")
    .description("list notifications, or: read-all | archive <id> | unarchive <id> (auth required)")
    .option("--page <n>", "page number (list)")
    .option("--limit <n>", "items per page (list)")
    .option("--filter <filter>", "ALL | ARCHIVED (list)")
    .action(async (action: string | undefined, id: string | undefined, options: ActionOptions, cmd: Command) => {
      const context = contextOf(cmd);
      await runAction(context, async () => {
        const client = context.client;
        const verb = action ?? "list";
        if (verb === "list") {
          const filter = options.filter !== undefined ? options.filter.toUpperCase() : undefined;
          if (filter !== undefined && filter !== "ALL" && filter !== "ARCHIVED") {
            throw new UsageError(`--filter expects ALL or ARCHIVED, got ${JSON.stringify(options.filter)}`);
          }
          const items = await client.notifications({ page: pageOf(options), limit: limitOf(options), filter });
          if (context.json) printJson(items, context.verbose);
          else printNotifications(items);
          return;
        }
        if (verb === "read-all") {
          const result = await client.markAllNotificationsAsRead();
          if (context.json) printJson(result, context.verbose);
          else console.log(result ? "All notifications marked as read." : "Server returned false.");
          return;
        }
        if (verb === "archive" || verb === "unarchive") {
          if (id === undefined) throw new UsageError(`notifications ${verb} needs a notification id`);
          const result = verb === "archive"
            ? await client.markNotificationAsArchived(idArgument(id, "notification id"))
            : await client.markNotificationAsUnarchived(idArgument(id, "notification id"));
          if (context.json) printJson(result, context.verbose);
          else console.log(result ? `Notification ${id} ${verb === "archive" ? "archived" : "unarchived"}.` : "Server returned false.");
          return;
        }
        throw new UsageError(`unknown notifications action ${JSON.stringify(action)}; expected list, read-all, archive or unarchive`);
      });
    });

  // -- Messaging -----------------------------------------------------------------

  program
    .command("messages [action] [target] [text]")
    .description("list conversations, read a conversation, send a message, unread count (auth required)")
    .option("--limit <n>", "items per page")
    .option("--page <n>", "page number (read)")
    .action(async (action: string | undefined, target: string | undefined, text: string | undefined, options: ActionOptions, cmd: Command) => {
      const context = contextOf(cmd);
      await runAction(context, async () => {
        const client = context.client;
        const verb = action ?? "list";
        if (verb === "list") {
          const page = await client.conversations({ limit: limitOf(options) });
          if (context.json) printJson(page, context.verbose);
          else printConversations(page);
          return;
        }
        if (verb === "read") {
          if (target === undefined) throw new UsageError("messages read needs the other user's numeric id");
          const page = await client.messages(idArgument(target, "user id"), { limit: limitOf(options), page: pageOf(options) });
          if (context.json) printJson(page, context.verbose);
          else printMessages(page.items ?? []);
          return;
        }
        if (verb === "send") {
          if (target === undefined || text === undefined) throw new UsageError("messages send needs <receiver-id> <text>");
          const sent = await client.sendMessage(idArgument(target, "receiver id"), text);
          if (context.json) printJson(sent, context.verbose);
          else console.log(`Message ${sent.id ?? "?"} sent to ${target}.`);
          return;
        }
        if (verb === "unread") {
          const count = await client.totalUnreadCount();
          if (context.json) printJson(count, context.verbose);
          else console.log(`Unread messages: ${count ?? 0}`);
          return;
        }
        throw new UsageError(`unknown messages action ${JSON.stringify(action)}; expected list, read, send or unread`);
      });
    });

  // -- User ----------------------------------------------------------------------

  program
    .command("user <name>")
    .description("posts of a scrolller user (or --reddit for a reddit-user mirror)")
    .option("--limit <n>", "posts to fetch")
    .option("--reddit", "read the reddit-user mirror feed instead of a scrolller user")
    .action(async (name: string, options: ActionOptions, cmd: Command) => {
      const context = contextOf(cmd);
      await runAction(context, async () => {
        const limit = limitOf(options);
        const posts = options.reddit
          ? await context.client.listRedditUserPosts(name, { limit })
          : await context.client.listUserPosts(name, { limit });
        if (context.json) printJson(posts, context.verbose);
        else printUserPosts(name, posts);
      });
    });

  // -- Resolve / related / hide / report ------------------------------------------

  program
    .command("resolve <url>")
    .description("resolve a scrolller link to its post/subreddit/collection")
    .action(async (url: string, _options: ActionOptions, cmd: Command) => {
      url = toAbsoluteScrolllerUrl(normalizeRefArg(url));
      const context = contextOf(cmd);
      await runAction(context, async () => {
        const link = await context.client.resolveLink(url);
        if (context.json) printJson(link, context.verbose);
        else if (link === null) console.log("unknown link (server does not recognize it)");
        else printResolved(link);
      });
    });

  program
    .command("related <url>")
    .description('"More like this" — related subreddits for a post')
    .action(async (url: string, _options: ActionOptions, cmd: Command) => {
      url = toAbsoluteScrolllerUrl(normalizeRefArg(url));
      const context = contextOf(cmd);
      await runAction(context, async () => {
        const recommendations = await context.client.related(url);
        if (context.json) printJson(recommendations, context.verbose);
        else {
          const subreddits = recommendations.subreddits ?? [];
          if (subreddits.length === 0) {
            console.log("no related subreddits");
            return;
          }
          console.log(`related subreddits (${subreddits.length}):`);
          for (const entry of subreddits) console.log(`  ${entry.subredditUrl ?? "?"}`);
        }
      });
    });

  program
    .command("hide [url]")
    .description("hide a post/subreddit URL, or list hide rules with no argument (auth required)")
    .action(async (url: string | undefined, _options: ActionOptions, cmd: Command) => {
      if (url !== undefined) url = toAbsoluteScrolllerUrl(normalizeRefArg(url));
      const context = contextOf(cmd);
      await runAction(context, async () => {
        const client = context.client;
        if (url === undefined) {
          const rules = await client.hideRulesWithUrl();
          if (context.json) printJson(rules, context.verbose);
          else printHideRules(rules);
          return;
        }
        const link = await client.resolveLink(url);
        const postId = link?.post?.id;
        const subredditId = link?.subreddit?.id;
        if (postId !== null && postId !== undefined) {
          const numeric = typeof postId === "number" ? postId : Number(postId);
          const rule = await client.hideContent({ contentType: "POST", targetId: numeric });
          if (context.json) printJson(rule, context.verbose);
          else console.log(`Post ${numeric} hidden (rule id=${rule?.id ?? "?"}).`);
          return;
        }
        if (subredditId !== null && subredditId !== undefined) {
          const numeric = typeof subredditId === "number" ? subredditId : Number(subredditId);
          const rule = await client.hideContent({ contentType: "SUBREDDIT", targetId: numeric });
          if (context.json) printJson(rule, context.verbose);
          else console.log(`Subreddit ${numeric} hidden (rule id=${rule?.id ?? "?"}).`);
          return;
        }
        throw new NotFoundError(`cannot hide ${JSON.stringify(url)}: the link does not resolve to a post or subreddit`);
      });
    });

  program
    .command("unhide <url>")
    .description("unhide a previously hidden post/subreddit URL (auth required)")
    .action(async (url: string, _options: ActionOptions, cmd: Command) => {
      url = toAbsoluteScrolllerUrl(normalizeRefArg(url));
      const context = contextOf(cmd);
      await runAction(context, async () => {
        const link = await context.client.resolveLink(url);
        const postId = link?.post?.id;
        const subredditId = link?.subreddit?.id;
        const target = postId !== null && postId !== undefined
          ? { contentType: "POST" as const, targetId: Number(postId) }
          : subredditId !== null && subredditId !== undefined
            ? { contentType: "SUBREDDIT" as const, targetId: Number(subredditId) }
            : null;
        if (target === null || !Number.isInteger(target.targetId)) {
          throw new NotFoundError(`cannot unhide ${JSON.stringify(url)}: the link does not resolve to a post or subreddit`);
        }
        const result = await context.client.unhideContent(target);
        if (context.json) printJson(result, context.verbose);
        else console.log(result ? `Unhidden: ${target.contentType} ${target.targetId}` : "Server returned false.");
      });
    });

  program
    .command("report <url> <reason> [details]")
    .description("report a post (auth required)")
    .action(async (url: string, reason: string, details: string | undefined, _options: ActionOptions, cmd: Command) => {
      url = normalizeRefArg(url);
      const context = contextOf(cmd);
      await runAction(context, async () => {
        const postId = await resolvePostId(context.client, url);
        const result = await context.client.reportPost(postId, reason, details);
        if (context.json) printJson(result, context.verbose);
        else console.log(result ? `Post ${postId} reported.` : "Server returned false.");
      });
    });

  // -- Download -------------------------------------------------------------------

  program
    .command("download <ref>")
    .description("download a post (<post-url>) or N items by query (<query> -n 10)")
    .option("-n, --count <n>", "number of items when downloading by query")
    .option("-o, --out <dir>", "output directory (default: config download_dir)")
    .option("-c, --concurrency <n>", "parallel downloads", "4")
    .action(async (ref: string, options: ActionOptions, cmd: Command) => {
      ref = normalizeRefArg(ref);
      const context = contextOf(cmd);
      await runAction(context, async () => {
        let posts: PostResult[];
        if (looksLikePostRef(ref)) {
          const post = await context.client.getPost(ref);
          if (post === null || post === undefined) {
            throw new NotFoundError(`server returned no post for ${JSON.stringify(ref)} (the API can soft-null under rapid requests — retry shortly)`);
          }
          posts = [post];
        } else {
          const count = options.count !== undefined ? coerceIntOption(options.count, "count") : 1;
          posts = await collectQueryPosts(context.client, ref, count);
          if (posts.length === 0) {
            throw new NotFoundError(`no posts found for query ${JSON.stringify(ref)}`);
          }
        }
        const dir = options.out ?? context.client.config.downloadDir;
        if (!dir) {
          throw new UsageError("no download directory: pass -o <dir> or set download_dir (scrolller config set download_dir <dir>)");
        }
        const concurrency = options.concurrency !== undefined ? coerceIntOption(options.concurrency, "concurrency") : 4;
        const progress = new ProgressRenderer(!context.json, posts.length);
        const results = await runDownload(context.client, posts, dir, concurrency, progress);
        if (context.json) {
          printJson(results, context.verbose);
        } else {
          printDownloadResults(results);
        }
        const succeeded = results.filter((r) => !r.error).length;
        if (succeeded === 0) process.exit(1);
      });
    });

  // -- Agent routes -----------------------------------------------------------------

  program
    .command("agent <kind> <ref>")
    .description("official agent route: subreddit | content | collection (embed-safe JSON)")
    .option("--format <format>", "json | ld+json")
    .option("--limit <n>", "items (subreddit/collection routes)")
    .action(async (kind: string, ref: string, options: ActionOptions, cmd: Command) => {
      ref = normalizeRefArg(ref);
      const context = contextOf(cmd);
      await runAction(context, async () => {
        const format = options.format !== undefined ? options.format.toLowerCase() : undefined;
        if (format !== undefined && format !== "json" && format !== "ld+json") {
          throw new UsageError(`--format expects json or ld+json, got ${JSON.stringify(options.format)}`);
        }
        const agentOptions = {
          format: format === "ld+json" ? ("ld+json" as const) : format === "json" ? ("json" as const) : undefined,
          limit: options.limit !== undefined ? coerceIntOption(options.limit, "limit") : undefined,
        };
        let result: Record<string, unknown>;
        if (kind === "subreddit") result = await context.client.agentSubreddit(ref, agentOptions);
        else if (kind === "content") result = await context.client.agentContent(ref, agentOptions);
        else if (kind === "collection") result = await context.client.agentCollection(ref, agentOptions);
        else throw new UsageError(`unknown agent kind ${JSON.stringify(kind)}; expected subreddit, content or collection`);
        if (context.json) printJson(result, context.verbose);
        else console.log(JSON.stringify(result, null, 2));
      });
    });

  // -- Config -------------------------------------------------------------------------

  program
    .command("config <action> [key] [value]")
    .description("get or set config values (nsfw, user_agent, extra_headers, proxy, download_dir, timeout_ms, token)")
    .action(async (action: string, key: string | undefined, value: string | undefined, _options: ActionOptions, cmd: Command) => {
      const context = contextOf(cmd);
      await runAction(context, async () => {
        const client = context.client;
        const configPath = client.config.configPath;
        if (action === "get") {
          if (key !== undefined || value !== undefined) throw new UsageError("config get takes no further arguments");
          const masked = { ...client.config, token: client.config.token ? "***" : null };
          if (context.json) printJson(masked, context.verbose);
          else {
            printKeyValue(`config (${configPath})`, [
              ["token", masked.token ?? "(not set)"],
              ["nsfw", client.config.nsfw],
              ["user_agent", client.config.userAgent ?? "(bundled browser UA)"],
              ["extra_headers", Object.keys(client.config.extraHeaders).length > 0 ? client.config.extraHeaders : "(none)"],
              ["proxy", client.config.proxy ?? "(none)"],
              ["download_dir", client.config.downloadDir ?? "(not set)"],
              ["timeout_ms", client.config.timeoutMs],
              ["base_url", client.config.baseUrl],
            ]);
          }
          return;
        }
        if (action === "set") {
          if (key === undefined || value === undefined) {
            throw new UsageError("config set needs <key> <value>; keys: token, nsfw, user_agent, extra_headers, proxy, download_dir, timeout_ms");
          }
          const patch = configPatch(key, value);
          const merged = updateConfigFile(configPath, patch);
          if (context.json) printJson({ ...merged, token: merged["token"] ? "***" : null }, context.verbose);
          else console.log(`Set ${key}. Config file: ${configPath}`);
          return;
        }
        throw new UsageError(`unknown config action ${JSON.stringify(action)}; expected get or set`);
      });
    });

  // -- Proxy ----------------------------------------------------------------------------

  program
    .command("proxy")
    .description("interactive proxy wizard (test + save); --test / --clear for non-interactive use")
    .option("--test", "test the currently configured proxy with a real discover call")
    .option("--clear", "clear the proxy from the config")
    .action(async (options: ActionOptions, cmd: Command) => {
      const context = contextOf(cmd);
      await runAction(context, async () => {
        const client = context.client;
        if (options.clear) {
          client.setProxy(null);
          if (context.json) printJson({ proxy: null }, context.verbose);
          else console.log("Proxy cleared.");
          return;
        }
        if (options.test) {
          const proxy = client.config.proxy;
          if (!proxy) throw new UsageError("no proxy configured (run scrolller proxy, or scrolller config set proxy <url>)");
          const latency = await testProxy(client.config.configPath, proxy);
          if (context.json) printJson({ proxy, latency_ms: latency, ok: true }, context.verbose);
          else console.log(`Proxy OK: discover through ${proxy.type}://${proxy.host}:${proxy.port} took ${latency} ms.`);
          return;
        }
        // Interactive wizard (TTY-checked inside).
        const candidate = await promptProxyConfig();
        const candidateConfig = asProxyConfig(candidate);
        if (candidateConfig === null) throw new UsageError("proxy configuration is incomplete");
        console.log(`Testing proxy ${candidate.type}://${candidate.host}:${candidate.port} (discover through it)...`);
        const latency = await testProxy(client.config.configPath, candidateConfig);
        console.log(`Proxy OK: discover took ${latency} ms.`);
        const save = await promptConfirm("Save this proxy to the config?", false);
        if (save) {
          client.setProxy(candidateConfig);
          console.log(`Proxy saved to ${client.config.configPath}`);
        } else {
          console.log("Proxy not saved.");
        }
        if (context.json) printJson({ proxy: client.config.proxy, latency_ms: latency, saved: save }, context.verbose);
      });
    });
}

/** Test a proxy configuration with a real anonymous discover call; returns latency in ms. */
async function testProxy(configPath: string, proxy: ProxyConfig): Promise<number> {
  const testClient = new ScrolllerClient({ proxy, timeoutMs: 30000, configPath });
  const started = Date.now();
  await testClient.discover({ limit: 1, childLimit: 1 });
  await testClient.dispatcher.close();
  return Date.now() - started;
}

/** Validate + convert a `config set <key> <value>` pair into a config patch. */
function configPatch(key: string, value: string): Record<string, unknown> {
  const asNull = (raw: string): string | null => (raw === "null" ? null : raw);
  switch (key) {
    case "token":
    case "user_agent":
    case "download_dir":
      return { [key]: asNull(value) };
    case "nsfw": {
      const normalized = value.trim().toUpperCase();
      if (normalized !== "SFW" && normalized !== "NSFW" && normalized !== "ALL") {
        throw new UsageError(`nsfw must be SFW, NSFW or ALL, got ${JSON.stringify(value)}`);
      }
      return { [key]: normalized };
    }
    case "timeout_ms": {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new UsageError(`timeout_ms must be a positive integer, got ${JSON.stringify(value)}`);
      }
      return { [key]: parsed };
    }
    case "extra_headers": {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        throw new UsageError(`extra_headers must be a JSON object, got ${JSON.stringify(value)}`);
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new UsageError(`extra_headers must be a JSON object, got ${JSON.stringify(value)}`);
      }
      return { [key]: parsed };
    }
    case "proxy": {
      if (value === "null") return { proxy: null };
      const config = asProxyConfig(value);
      if (config === null) throw new UsageError(`proxy value must be a proxy URL, got ${JSON.stringify(value)}`);
      return { [key]: proxyConfigToDict(config) };
    }
    default:
      throw new UsageError(`unknown config key ${JSON.stringify(key)}; keys: token, nsfw, user_agent, extra_headers, proxy, download_dir, timeout_ms`);
  }
}

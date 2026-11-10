/** All MCP tools (CONTRACT.md §6 MCP column) on ONE shared ScrolllerClient.
 *
 * - Reads carry an explicit optional `nsfw` param; unset means the client
 *   config decides (SCROLLLER_NSFW env > config file > SFW default).
 * - Results are compact JSON (mediaSources trimmed to the best entry) unless
 *   `verbose: true`.
 * - Errors map to isError results with kind+message+hint (§5.1 auth hint).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { downloadToDir, NotFoundError, updateConfigFile, type ScrolllerClient } from "scrolller-core";
import { collectQueryPosts, resolvePostRefToId, toAbsoluteScrolllerUrl, toRelativePostPath, toolError, toolJson } from "./util.js";

const NSFW = z.enum(["SFW", "NSFW", "ALL"]).optional().describe("Content filter; omit to use the configured default (SFW)");
const VERBOSE = z.boolean().optional().describe("Return full results — do not trim media arrays to the best entry");
const SORT_BY = z.enum(["RANDOM", "TOP", "HOT", "NEW", "CONTROVERSIAL"]).optional();
const GALLERY_FILTER = z.enum(["CATEGORY", "SUBREDDIT", "ALBUM", "VIDEO", "PICTURE", "SOUND"]).optional();
/** Post ref: scrolller post URL, redditPath, or numeric post id. */
const POST_REF = z.union([z.string(), z.number()]).describe("Scrolller post URL, redditPath, or numeric post id");

async function handle(body: () => Promise<ReturnType<typeof toolJson>>): Promise<ReturnType<typeof toolJson>> {
  try {
    return await body();
  } catch (error) {
    return toolError(error);
  }
}

function maskedConfig(client: ScrolllerClient): Record<string, unknown> {
  return { ...client.config, token: client.config.token ? "***" : null };
}

/** Register every tool on the server. */
export function registerTools(server: McpServer, client: ScrolllerClient): void {
  // -- Feeds / search (public) -------------------------------------------------

  server.registerTool(
    "discover",
    {
      description: "Discover feed: subreddit cards with embedded posts.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().describe("Subreddit cards per page"),
        child_limit: z.number().int().min(1).max(100).optional().describe("Posts embedded per card"),
        sort_by: SORT_BY,
        filter: GALLERY_FILTER,
        iterator: z.string().optional().describe("Resume cursor from a previous page (pass back byte-exact)"),
        include_filters: z.array(z.number().int()).optional().describe("Category ids to include (from the site category tree)"),
        exclude_filters: z.array(z.number().int()).optional().describe("Category ids to exclude"),
        nsfw: NSFW,
        verbose: VERBOSE,
      },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      handle(async () =>
        toolJson(await client.discover({
          limit: args.limit,
          childLimit: args.child_limit,
          sortBy: args.sort_by,
          filter: args.filter,
          iterator: args.iterator,
          includeFilters: args.include_filters,
          excludeFilters: args.exclude_filters,
          nsfw: args.nsfw,
        }), args.verbose === true),
      ),
  );

  server.registerTool(
    "search_media",
    {
      description:
        "Search: subreddit cards matching a query (the site's search page). No per-post media search exists server-side; use subreddit_feed on the matches for posts.",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().min(1).max(100).optional(),
        page_index: z.number().int().min(0).optional().describe("Result page (0-based; search paginates by offset)"),
        nsfw: NSFW,
        verbose: VERBOSE,
      },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      handle(async () =>
        toolJson(await client.searchSubredditWithPreview(args.query, {
          limit: args.limit,
          pageIndex: args.page_index,
        }), args.verbose === true),
      ),
  );

  server.registerTool(
    "subreddit_feed",
    {
      description: "Subreddit feed: subreddit card + posts. Accepts 'aww', '/r/aww' or an absolute scrolller.com URL.",
      inputSchema: {
        name: z.string().min(1).describe("Subreddit name, /r/name path, or URL"),
        limit: z.number().int().min(1).max(100).optional(),
        sort_by: SORT_BY,
        filter: GALLERY_FILTER,
        nsfw: NSFW,
        verbose: VERBOSE,
      },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      handle(async () =>
        toolJson(await client.subredditFeed(args.name, {
          limit: args.limit,
          sortBy: args.sort_by,
          filter: args.filter,
          nsfw: args.nsfw,
        }), args.verbose === true),
      ),
  );

  server.registerTool(
    "search_subreddits",
    {
      description: "Subreddit autocomplete search (title/url/item_count/preview).",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().min(1).max(100).optional(),
        page_index: z.number().int().min(0).optional(),
        is_nsfw: z.boolean().optional().describe("Explicit NSFW flag; omit to derive from the configured filter (NSFW -> true)"),
        verbose: VERBOSE,
      },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      handle(async () =>
        toolJson(await client.searchSubreddits(args.query, {
          limit: args.limit,
          pageIndex: args.page_index,
          isNsfw: args.is_nsfw,
        }), args.verbose === true),
      ),
  );

  // -- Posts / comments (read) ---------------------------------------------------

  server.registerTool(
    "get_post",
    {
      description: "Post details by scrolller URL (title, counts, mediaSources).",
      inputSchema: { url: z.string().min(1).describe("Scrolller post URL"), verbose: VERBOSE },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      handle(async () => {
        const post = await client.getPost(toRelativePostPath(args.url));
        if (post === null || post === undefined) {
          return toolError(new NotFoundError(`server returned no post for ${JSON.stringify(args.url)} (the API can soft-null under rapid requests — retry shortly)`));
        }
        return toolJson(post, args.verbose === true);
      }),
  );

  server.registerTool(
    "read_comments",
    {
      description: "Top-level comments of a post (plain array; cursor = last comment id for the next page).",
      inputSchema: {
        url: POST_REF,
        limit: z.number().int().min(1).max(100).optional().describe("Comments per page (site default 15)"),
        cursor: z.number().int().optional().describe("Last comment id of the previous page"),
        verbose: VERBOSE,
      },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      handle(async () =>
        toolJson(await client.getComments(toAbsoluteScrolllerUrl(String(args.url)), { limit: args.limit, cursor: args.cursor }), args.verbose === true),
      ),
  );

  // -- Comments (write, auth) ------------------------------------------------------

  server.registerTool(
    "add_comment",
    {
      description: "Add a comment to a post (auth required).",
      inputSchema: { url: POST_REF, content: z.string().min(1).describe("Comment text"), verbose: VERBOSE },
    },
    async (args) => handle(async () => toolJson(await client.createComment(toAbsoluteScrolllerUrl(String(args.url)), args.content), args.verbose === true)),
  );

  server.registerTool(
    "reply_comment",
    {
      description: "Reply to a comment (auth required).",
      inputSchema: {
        parent_comment_id: z.number().int(),
        content: z.string().min(1).describe("Reply text"),
        verbose: VERBOSE,
      },
    },
    async (args) => handle(async () => toolJson(await client.createCommentReply(args.content, args.parent_comment_id), args.verbose === true)),
  );

  server.registerTool(
    "like_comment",
    {
      description: "Like a comment (auth required).",
      inputSchema: { comment_id: z.number().int(), verbose: VERBOSE },
    },
    async (args) => handle(async () => toolJson(await client.likeComment(args.comment_id), args.verbose === true)),
  );

  server.registerTool(
    "delete_comment",
    {
      description: "Delete a comment (auth required; must be your own).",
      inputSchema: { comment_id: z.number().int(), verbose: VERBOSE },
    },
    async (args) => handle(async () => toolJson(await client.deleteComment(args.comment_id), args.verbose === true)),
  );

  // -- Likes / reposts / follow (auth) ----------------------------------------------

  const boolTool = (
    name: string,
    description: string,
    call: (url: string) => Promise<boolean>,
  ): void => {
    server.registerTool(
      name,
      { description, inputSchema: { url: z.string().min(1).describe("Scrolller post (or subreddit/user) URL"), verbose: VERBOSE } },
      async (args) => handle(async () => toolJson(await call(args.url), args.verbose === true)),
    );
  };

  boolTool("like_post", "Like a post (auth required).", (url) => client.like(url));
  boolTool("unlike_post", "Remove a like from a post (auth required).", (url) => client.unlike(url));
  boolTool("repost_post", "Repost a post (auth required).", (url) => client.repost(url));
  boolTool("unrepost_post", "Remove a repost (auth required).", (url) => client.unrepost(url));
  boolTool("follow", "Follow a subreddit or user URL (auth required).", (url) => client.follow(url));
  boolTool("unfollow", "Unfollow a subreddit or user URL (auth required).", (url) => client.unfollow(url));

  // -- Collections (auth) -------------------------------------------------------------

  server.registerTool(
    "list_collections",
    { description: "List the logged-in user's collections.", inputSchema: { verbose: VERBOSE } },
    async (args) => handle(async () => toolJson(await client.collections(), args.verbose === true)),
  );

  server.registerTool(
    "get_collection",
    { description: "Collection details by numeric id.", inputSchema: { id: z.number().int(), verbose: VERBOSE } },
    async (args) => handle(async () => toolJson(await client.collection(args.id), args.verbose === true)),
  );

  server.registerTool(
    "create_collection",
    {
      description: "Create a collection (auth required).",
      inputSchema: {
        title: z.string().min(1),
        description: z.string().optional(),
        is_private: z.boolean().optional(),
        is_nsfw: z.boolean().optional(),
        verbose: VERBOSE,
      },
    },
    async (args) =>
      handle(async () =>
        toolJson(await client.createCollection(args.title, {
          description: args.description,
          isPrivate: args.is_private,
          isNsfw: args.is_nsfw,
        }), args.verbose === true),
      ),
  );

  server.registerTool(
    "add_to_collection",
    { description: "Add a post to a collection (auth required).", inputSchema: { collection_id: z.number().int(), url: POST_REF, verbose: VERBOSE } },
    async (args) =>
      handle(async () => {
        const postId = await resolvePostRefToId(client, args.url);
        return toolJson({ post_id: postId, added: await client.collectionAddPost(postId, args.collection_id) }, args.verbose === true);
      }),
  );

  server.registerTool(
    "remove_from_collection",
    { description: "Remove a post from a collection (auth required).", inputSchema: { collection_id: z.number().int(), url: POST_REF, verbose: VERBOSE } },
    async (args) =>
      handle(async () => {
        const postId = await resolvePostRefToId(client, args.url);
        return toolJson({ post_id: postId, removed: await client.collectionRemovePost(postId, args.collection_id) }, args.verbose === true);
      }),
  );

  server.registerTool(
    "edit_collection",
    {
      description: "Rename / edit a collection (auth required).",
      inputSchema: {
        id: z.number().int(),
        title: z.string().min(1).describe("New title"),
        description: z.string().optional(),
        is_private: z.boolean().optional(),
        is_nsfw: z.boolean().optional(),
        verbose: VERBOSE,
      },
    },
    async (args) =>
      handle(async () =>
        toolJson(await client.editCollection(args.id, args.title, {
          description: args.description,
          isPrivate: args.is_private,
          isNsfw: args.is_nsfw,
        }), args.verbose === true),
      ),
  );

  server.registerTool(
    "delete_collection",
    { description: "Delete a collection (auth required).", inputSchema: { id: z.number().int(), verbose: VERBOSE } },
    async (args) => handle(async () => toolJson(await client.deleteCollection(args.id), args.verbose === true)),
  );

  // -- Account -------------------------------------------------------------------------

  server.registerTool(
    "whoami",
    { description: "Profile of the logged-in user (auth required).", inputSchema: { verbose: VERBOSE } },
    async (args) => handle(async () => toolJson(await client.me(), args.verbose === true)),
  );

  server.registerTool(
    "login",
    {
      description: "Login with username/password; persists the token to the shared config (auth for other tools then works).",
      inputSchema: { username: z.string().min(1), password: z.string().min(1), verbose: VERBOSE },
    },
    async (args) =>
      handle(async () => {
        const result = await client.login(args.username, args.password);
        // The token is persisted to the config; do not echo it into transcripts.
        return toolJson({ ...result, token: result.token ? "***" : null }, args.verbose === true);
      }),
  );

  server.registerTool(
    "set_token",
    {
      description: "Store an auth token manually (persists to the config). Token source: browser localStorage[\"SCROLLLER_BETA_1:SCROLLLER_LOGIN_DEV\"].",
      inputSchema: { token: z.string().min(1), verbose: VERBOSE },
    },
    async (args) =>
      handle(async () => {
        client.setToken(args.token);
        return toolJson({ saved: true, config_path: client.config.configPath }, args.verbose === true);
      }),
  );

  server.registerTool(
    "logout",
    { description: "Clear the stored token from the config.", inputSchema: { verbose: VERBOSE } },
    async (args) =>
      handle(async () => {
        client.logout();
        return toolJson({ logged_out: true }, args.verbose === true);
      }),
  );

  // -- Notifications / messages (auth) ---------------------------------------------------

  server.registerTool(
    "get_notifications",
    {
      description: "Notification list (auth required).",
      inputSchema: {
        page: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        filter: z.enum(["ALL", "ARCHIVED"]).optional(),
        verbose: VERBOSE,
      },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      handle(async () =>
        toolJson(await client.notifications({ page: args.page, limit: args.limit, filter: args.filter }), args.verbose === true),
      ),
  );

  server.registerTool(
    "mark_notifications",
    {
      description: "Mark notifications read-all, or archive/unarchive one by id (auth required).",
      inputSchema: {
        action: z.enum(["read-all", "archive", "unarchive"]),
        id: z.number().int().optional().describe("Notification id (required for archive/unarchive)"),
        verbose: VERBOSE,
      },
    },
    async (args) =>
      handle(async () => {
        let result: boolean;
        if (args.action === "read-all") {
          result = await client.markAllNotificationsAsRead();
        } else {
          if (args.id === undefined) {
            return toolError(new Error(`mark_notifications action "${args.action}" requires an id`));
          }
          result = args.action === "archive"
            ? await client.markNotificationAsArchived(args.id)
            : await client.markNotificationAsUnarchived(args.id);
        }
        return toolJson({ action: args.action, id: args.id ?? null, ok: result }, args.verbose === true);
      }),
  );

  server.registerTool(
    "get_conversations",
    { description: "List message conversations (auth required).", inputSchema: { limit: z.number().int().min(1).max(100).optional(), verbose: VERBOSE } },
    async (args) => handle(async () => toolJson(await client.conversations({ limit: args.limit }), args.verbose === true)),
  );

  server.registerTool(
    "get_messages",
    {
      description: "Messages of one conversation, keyed by the other user's numeric id (auth required).",
      inputSchema: {
        user_id: z.number().int().describe("The other user's numeric id (from get_conversations)"),
        limit: z.number().int().min(1).max(100).optional(),
        page: z.number().int().min(0).optional(),
        verbose: VERBOSE,
      },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      handle(async () => toolJson(await client.messages(args.user_id, { limit: args.limit, page: args.page }), args.verbose === true)),
  );

  server.registerTool(
    "send_message",
    { description: "Send a message to a user id (auth required).", inputSchema: { receiver_id: z.number().int(), content: z.string().min(1), verbose: VERBOSE } },
    async (args) => handle(async () => toolJson(await client.sendMessage(args.receiver_id, args.content), args.verbose === true)),
  );

  // -- User posts --------------------------------------------------------------------------

  server.registerTool(
    "get_user",
    {
      description: "Posts of a scrolller user (or a reddit-user mirror with reddit: true). No separate profile method exists in core — use whoami for the logged-in profile.",
      inputSchema: {
        username: z.string().min(1),
        limit: z.number().int().min(1).max(100).optional(),
        reddit: z.boolean().optional().describe("Read the reddit-user mirror feed instead of a scrolller user"),
        nsfw: NSFW,
        verbose: VERBOSE,
      },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      handle(async () => {
        const options = { limit: args.limit, nsfw: args.nsfw };
        const page = args.reddit === true
          ? await client.getRedditUserPosts(args.username, options)
          : await client.getUserPosts(args.username, options);
        return toolJson(page, args.verbose === true);
      }),
  );

  // -- Resolve / related / hide / report -----------------------------------------------------

  server.registerTool(
    "resolve_link",
    { description: "Resolve a scrolller.com link to its post/subreddit/collection; null when unknown.", inputSchema: { url: z.string().min(1), verbose: VERBOSE } },
    async (args) => handle(async () => toolJson(await client.resolveLink(toAbsoluteScrolllerUrl(args.url)), args.verbose === true)),
  );

  server.registerTool(
    "get_related",
    { description: '"More like this" — related subreddits for a post (ref: URL or post id).', inputSchema: { ref: POST_REF, verbose: VERBOSE } },
    async (args) => handle(async () => toolJson(await client.related(typeof args.ref === "number" ? args.ref : toAbsoluteScrolllerUrl(args.ref)), args.verbose === true)),
  );

  server.registerTool(
    "hide_post",
    {
      description: "Hide a post or subreddit the URL resolves to (auth required).",
      inputSchema: { url: z.string().min(1).describe("Scrolller post or subreddit URL"), verbose: VERBOSE },
    },
    async (args) =>
      handle(async () => {
        const link = await client.resolveLink(toAbsoluteScrolllerUrl(args.url));
        const postId = link?.post?.id;
        const subredditId = link?.subreddit?.id;
        const numericPost = typeof postId === "number" ? postId : typeof postId === "string" ? Number(postId) : NaN;
        const numericSub = typeof subredditId === "number" ? subredditId : typeof subredditId === "string" ? Number(subredditId) : NaN;
        if (Number.isInteger(numericPost)) {
          return toolJson(await client.hideContent({ contentType: "POST", targetId: numericPost }), args.verbose === true);
        }
        if (Number.isInteger(numericSub)) {
          return toolJson(await client.hideContent({ contentType: "SUBREDDIT", targetId: numericSub }), args.verbose === true);
        }
        return toolError(new Error(`cannot hide ${JSON.stringify(args.url)}: the link does not resolve to a post or subreddit`));
      }),
  );

  server.registerTool(
    "unhide_post",
    { description: "Unhide a previously hidden post or subreddit URL (auth required).", inputSchema: { url: z.string().min(1), verbose: VERBOSE } },
    async (args) =>
      handle(async () => {
        const link = await client.resolveLink(toAbsoluteScrolllerUrl(args.url));
        const postId = link?.post?.id;
        const subredditId = link?.subreddit?.id;
        const numericPost = typeof postId === "number" ? postId : typeof postId === "string" ? Number(postId) : NaN;
        const numericSub = typeof subredditId === "number" ? subredditId : typeof subredditId === "string" ? Number(subredditId) : NaN;
        if (Number.isInteger(numericPost)) {
          return toolJson({ unhidden: await client.unhideContent({ contentType: "POST", targetId: numericPost }) }, args.verbose === true);
        }
        if (Number.isInteger(numericSub)) {
          return toolJson({ unhidden: await client.unhideContent({ contentType: "SUBREDDIT", targetId: numericSub }) }, args.verbose === true);
        }
        return toolError(new Error(`cannot unhide ${JSON.stringify(args.url)}: the link does not resolve to a post or subreddit`));
      }),
  );

  server.registerTool(
    "get_hide_rules",
    { description: "Current hide rules with resolved URLs (auth required).", inputSchema: { verbose: VERBOSE } },
    async (args) => handle(async () => toolJson(await client.hideRulesWithUrl(), args.verbose === true)),
  );

  server.registerTool(
    "report_post",
    { description: "Report a post (auth required).", inputSchema: { url: POST_REF, reason: z.string().min(1), details: z.string().optional(), verbose: VERBOSE } },
    async (args) =>
      handle(async () => {
        const postId = await resolvePostRefToId(client, args.url);
        return toolJson({ post_id: postId, reported: await client.reportPost(postId, args.reason, args.details) }, args.verbose === true);
      }),
  );

  // -- Download ---------------------------------------------------------------------------

  server.registerTool(
    "download_media",
    {
      description:
        "Download a post's best media (post_url), or N posts by query (query + count). Returns saved file paths. Downloads come only from post-level mediaSources[].",
      inputSchema: {
        post_url: z.string().min(1).optional().describe("Scrolller post URL for a single download"),
        query: z.string().min(1).optional().describe("Search query; downloads `count` posts"),
        count: z.number().int().min(1).max(50).optional().describe("How many posts when downloading by query (default 5)"),
        out_dir: z.string().optional().describe("Output directory (default: config download_dir)"),
        verbose: VERBOSE,
      },
    },
    async (args) =>
      handle(async () => {
        const dir = args.out_dir ?? client.config.downloadDir;
        if (!dir) {
          return toolError(new Error("no download directory: pass out_dir or set download_dir in the config (update_config)"));
        }
        let posts;
        if (args.post_url !== undefined) {
          const post = await client.getPost(toRelativePostPath(args.post_url));
          if (post === null || post === undefined) {
            return toolError(new NotFoundError(`server returned no post for ${JSON.stringify(args.post_url)} (the API can soft-null under rapid requests — retry shortly)`));
          }
          posts = [post];
        } else if (args.query !== undefined) {
          posts = await collectQueryPosts(client, args.query, args.count ?? 5);
          if (posts.length === 0) {
            return toolError(new Error(`no posts found for query ${JSON.stringify(args.query)}`));
          }
        } else {
          return toolError(new Error("download_media needs post_url, or query (+count)"));
        }
        const results = await downloadToDir(posts, dir, { concurrency: 4 });
        return toolJson({
          out_dir: dir,
          saved: results.filter((r) => !r.error).map((r) => r.path),
          failed: results.filter((r) => r.error).map((r) => ({ post_id: r.postId, error: r.error })),
        }, args.verbose === true);
      }),
  );

  // -- Agent routes (public, embed-safe) ----------------------------------------------------

  server.registerTool(
    "agent_subreddit",
    {
      description: "Official agent route /agent/subreddit/{slug} — embed-safe JSON, no raw media URLs (~1 req/s).",
      inputSchema: {
        slug: z.string().min(1),
        format: z.enum(["json", "ld+json"]).optional(),
        limit: z.number().int().min(1).optional(),
        verbose: VERBOSE,
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => handle(async () => toolJson(await client.agentSubreddit(args.slug, { format: args.format, limit: args.limit }), args.verbose === true)),
  );

  server.registerTool(
    "agent_content",
    {
      description: "Official agent route /agent/content/{slug} — embed-safe JSON, no raw media URLs (~1 req/s).",
      inputSchema: { slug: z.string().min(1), format: z.enum(["json", "ld+json"]).optional(), verbose: VERBOSE },
      annotations: { readOnlyHint: true },
    },
    async (args) => handle(async () => toolJson(await client.agentContent(args.slug, { format: args.format }), args.verbose === true)),
  );

  server.registerTool(
    "agent_collection",
    {
      description: "Official agent route /agent/collection/{id} — embed-safe JSON, no raw media URLs (~1 req/s).",
      inputSchema: {
        id: z.union([z.string(), z.number()]),
        format: z.enum(["json", "ld+json"]).optional(),
        limit: z.number().int().min(1).optional(),
        verbose: VERBOSE,
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => handle(async () => toolJson(await client.agentCollection(args.id, { format: args.format, limit: args.limit }), args.verbose === true)),
  );

  // -- Config / proxy -------------------------------------------------------------------------

  server.registerTool(
    "configure_proxy",
    {
      description: "Set and persist a proxy (http/https/socks4/socks5) in the shared config; applies to API calls and downloads.",
      inputSchema: {
        type: z.enum(["http", "https", "socks4", "socks5"]),
        host: z.string().min(1),
        port: z.number().int().min(1).max(65535),
        username: z.string().optional(),
        password: z.string().optional(),
        verbose: VERBOSE,
      },
    },
    async (args) =>
      handle(async () => {
        client.setProxy({ type: args.type, host: args.host, port: args.port, username: args.username ?? null, password: args.password ?? null });
        return toolJson({ proxy: client.config.proxy, config_path: client.config.configPath }, args.verbose === true);
      }),
  );

  server.registerTool(
    "clear_proxy",
    { description: "Remove the proxy from the shared config.", inputSchema: { verbose: VERBOSE } },
    async (args) =>
      handle(async () => {
        client.setProxy(null);
        return toolJson({ proxy: null, config_path: client.config.configPath }, args.verbose === true);
      }),
  );

  server.registerTool(
    "get_config",
    { description: "Effective configuration (env + config file merged); the token value is masked.", inputSchema: { verbose: VERBOSE } },
    async (args) => handle(async () => toolJson(maskedConfig(client), args.verbose === true)),
  );

  server.registerTool(
    "update_config",
    {
      description: "Deep-merge a patch into the config file (snake_case keys: token, nsfw, user_agent, extra_headers, proxy, download_dir, timeout_ms).",
      inputSchema: { patch: z.record(z.string(), z.unknown()).describe("Config-file patch object"), verbose: VERBOSE },
    },
    async (args) =>
      handle(async () => {
        const merged = updateConfigFile(client.config.configPath, args.patch);
        return toolJson({ config_path: client.config.configPath, config: { ...merged, token: merged["token"] ? "***" : null } }, args.verbose === true);
      }),
  );
}

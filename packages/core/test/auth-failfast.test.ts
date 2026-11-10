/** Unit tests for the 🔒 AUTH_REQUIRED fail-fast (CONTRACT.md §5.1): every
 * auth-required operation must throw AuthRequiredError BEFORE any network call.
 *
 * The client is pointed at an unreachable base URL — if an op tried to hit the
 * network it would fail with NetworkError instead, so asserting
 * AuthRequiredError proves the fail-fast path. All auth-locked families get a
 * representative probe.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { ScrolllerClient } from "../src/index.js";
import { AuthRequiredError } from "../src/errors.js";

/** Unreachable endpoint: port 9 (discard) on loopback refuses instantly. */
const UNREACHABLE = "http://127.0.0.1:9/admin";

let savedEnv: { SCROLLLER_TOKEN?: string; SCROLLLER_PROXY?: string };
let configDir: string;
let configPath: string;

before(() => {
  savedEnv = {
    SCROLLLER_TOKEN: process.env.SCROLLLER_TOKEN,
    SCROLLLER_PROXY: process.env.SCROLLLER_PROXY,
  };
  delete process.env.SCROLLLER_TOKEN; // deterministic no-token client
  delete process.env.SCROLLLER_PROXY;
  configDir = mkdtempSync(path.join(tmpdir(), "scrolller-core-test-"));
  configPath = path.join(configDir, "config.json");
});

after(() => {
  if (savedEnv.SCROLLLER_TOKEN !== undefined) process.env.SCROLLLER_TOKEN = savedEnv.SCROLLLER_TOKEN;
  if (savedEnv.SCROLLLER_PROXY !== undefined) process.env.SCROLLLER_PROXY = savedEnv.SCROLLLER_PROXY;
});

function makeClient(): ScrolllerClient {
  return new ScrolllerClient({ baseUrl: UNREACHABLE, configPath });
}

test("hasToken/requireAuth: no token -> hasToken false and requireAuth throws before network", () => {
  const client = makeClient();
  assert.equal(client.hasToken(), false);
  assert.throws(() => client.requireAuth(), AuthRequiredError);
});

const PROBES: Array<[string, (client: ScrolllerClient) => Promise<unknown>]> = [
  ["like (AddFavorite)", (c) => c.like("https://scrolller.com/r/aww/comments/x/y")],
  ["unlike (RemoveFavorite)", (c) => c.unlike("https://scrolller.com/r/aww/comments/x/y")],
  ["isFavorite (GetPostIsFavorite)", (c) => c.isFavorite("https://scrolller.com/r/aww/comments/x/y")],
  ["repost (RepostPost)", (c) => c.repost("https://scrolller.com/r/aww/comments/x/y")],
  ["unrepost (RemoveRepost)", (c) => c.unrepost("https://scrolller.com/r/aww/comments/x/y")],
  ["follow", (c) => c.follow("/r/aww")],
  ["unfollow", (c) => c.unfollow("/r/aww")],
  ["isFollowingSubreddit", (c) => c.isFollowingSubreddit([1])],
  ["isFollowingUser", (c) => c.isFollowingUser({ username: "x" })],
  ["isFollowingUserCollection", (c) => c.isFollowingUserCollection(1)],
  ["followingSubreddits", (c) => c.followingSubreddits()],
  ["followingCollections", (c) => c.followingCollections()],
  ["allFollowingContent", (c) => c.allFollowingContent()],
  ["collections (GetUserCollectionsQuery)", (c) => c.collections()],
  ["collection (GetCollectionById)", (c) => c.collection(1)],
  ["collectionByUrl", (c) => c.collectionByUrl("/collection/x")],
  ["collectionContent", (c) => c.collectionContent(1)],
  ["createCollection", (c) => c.createCollection("name")],
  ["editCollection", (c) => c.editCollection(1, "name")],
  ["deleteCollection", (c) => c.deleteCollection(1)],
  ["collectionAddPost", (c) => c.collectionAddPost(1, 2)],
  ["collectionRemovePost", (c) => c.collectionRemovePost(1, 2)],
  ["collectionSetup", (c) => c.collectionSetup(1)],
  ["paidCollections", (c) => c.paidCollections()],
  ["createComment", (c) => c.createComment("https://scrolller.com/r/aww/comments/x/y", "text")],
  ["createCommentReply", (c) => c.createCommentReply("text", 1)],
  ["likeComment", (c) => c.likeComment(1)],
  ["unlikeComment", (c) => c.unlikeComment(1)],
  ["deleteComment", (c) => c.deleteComment(1)],
  ["reportComment", (c) => c.reportComment(1, "spam")],
  ["reportPost", (c) => c.reportPost(1, "spam")],
  ["reportUser", (c) => c.reportUser(1, "spam")],
  ["reportCollection", (c) => c.reportCollection(1, "spam")],
  ["hideContent", (c) => c.hideContent({ contentType: "POST", targetId: 1 })],
  ["unhideContent", (c) => c.unhideContent({ contentType: "POST", targetId: 1 })],
  ["hideRules", (c) => c.hideRules()],
  ["hideRulesWithUrl", (c) => c.hideRulesWithUrl()],
  ["notifications", (c) => c.notifications()],
  ["markAllNotificationsAsRead", (c) => c.markAllNotificationsAsRead()],
  ["markNotificationAsArchived", (c) => c.markNotificationAsArchived(1)],
  ["markNotificationAsUnarchived", (c) => c.markNotificationAsUnarchived(1)],
  ["conversations", (c) => c.conversations()],
  ["messages", (c) => c.messages(1)],
  ["sendMessage", (c) => c.sendMessage(1, "hi")],
  ["markMessagesAsRead", (c) => c.markMessagesAsRead(1)],
  ["totalUnreadCount", (c) => c.totalUnreadCount()],
  ["me (GetLoggedInUserQuery)", (c) => c.me()],
  ["updateUser", (c) => c.updateUser({ bio: "x" })],
  ["updateInfo", (c) => c.updateInfo()],
  ["markPostWithSound", (c) => c.markPostWithSound(1, true)],
  ["account", (c) => c.account()],
  ["subscription", (c) => c.subscription()],
  ["creatorReport", (c) => c.creatorReport()],
  ["revShare", (c) => c.revShare()],
  ["uploadMedia", (c) => c.uploadMedia({ data: new Uint8Array(1), fileName: "x.bin" })],
  ["createCreatorPost", (c) =>
    c.createCreatorPost({
      title: "t",
      keywords: "k",
      isNsfw: false,
      mediaUrl: "https://example.com/x.jpg",
      subredditUrl: "/r/x",
      sourceSetId: 1,
      setHeader: false,
      mediaType: "PICTURE",
    })],
];

for (const [name, probe] of PROBES) {
  test(`fail-fast AUTH_REQUIRED before any network: ${name}`, async () => {
    const client = makeClient();
    await assert.rejects(probe(client), AuthRequiredError);
  });
}

test("public reads do NOT fail fast on an unreachable URL (they attempt the network)", async () => {
  const client = makeClient();
  // discover is public: it must attempt the network (NetworkError), proving
  // the auth guard is not over-applied to public operations.
  await assert.rejects(client.discover({ limit: 1, childLimit: 1 }), (error: unknown) => {
    assert.ok(!(error instanceof AuthRequiredError), "public op must not hit the auth guard");
    return true;
  });
});

test("plans() is public (PlanQuery live-verified anonymous) and attempts the network", async () => {
  const client = makeClient();
  await assert.rejects(client.plans(), (error: unknown) => {
    assert.ok(!(error instanceof AuthRequiredError), "PlanQuery must not hit the auth guard");
    return true;
  });
});

test("setToken persists to the config file; logout clears it (CONTRACT.md §3/§6 row 16)", () => {
  const client = makeClient();
  client.setToken("test-token-123");
  assert.equal(client.hasToken(), true);
  const fileData = JSON.parse(readFileSync(configPath, "utf8"));
  assert.equal(fileData.token, "test-token-123");

  client.logout();
  assert.equal(client.hasToken(), false);
  const cleared = JSON.parse(readFileSync(configPath, "utf8"));
  assert.equal(cleared.token, null);
});

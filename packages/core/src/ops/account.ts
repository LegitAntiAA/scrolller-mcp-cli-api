/** Account/profile/subscription/creator operations (CONTRACT.md §6 rows 15–16, 26*).
 *
 * *Row 26 (register) is NOT implemented — registerUser is reCAPTCHA-gated
 * server-side (CONTRACT.md §6 note; T1 §8.2). Login needs no captcha (T1 §2).
 *
 * Auth notes:
 * - login is public (sends "authorization": null like the site does) and
 *   persists the token via setToken.
 * - me/updateUser/updateInfo/markPostWithSound/account/subscription/creator
 *   reads/uploads are 🔒 fail-fast (CONTRACT.md §5.1).
 * - plans() is PUBLIC: PlanQuery is live-verified with authorization null (T1 §2).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { File as BufferFile } from "node:buffer";
import { fetch as undiciFetch, FormData as UndiciFormData } from "undici";
import { ScrolllerClient } from "../client.js";
import {
  ACCOUNT_QUERY,
  ADD_CREATOR_POST_MUTATION,
  GET_CREATOR_REPORT_QUERY,
  GET_LOGGED_IN_USER_QUERY,
  GET_REV_SHARE_QUERY,
  LOGIN_QUERY,
  MARK_POST_WITH_SOUND_MUTATION,
  PLAN_QUERY,
  SUBSCRIPTION_QUERY,
  UPDATE_INFO_MUTATION,
  UPDATE_USER_MUTATION,
} from "../queries.js";
import { errorMessage, ScrolllerError } from "../errors.js";
import { expectField } from "../op-utils.js";
import { ORIGIN } from "../transport.js";
import type {
  AccountResult,
  CreatorPostInput,
  CreatorPostResult,
  CreatorReportResult,
  LoggedInUserResult,
  LoginResult,
  PlanResult,
  SubscriptionResult,
  UpdateUserInput,
  UploadResult,
  UploadSource,
} from "../op-types.js";

/** Upload endpoint (T1 §1: config module 58785 export `l`; host4 appears only in a stale debug log). */
export const UPLOAD_URL = "https://host8.scrolller.com/upload";

async function login(this: ScrolllerClient, username: string, password: string): Promise<LoginResult> {
  // Anonymous body like the site (T1 §1: "Anonymous requests send authorization: null").
  const data = await this.request(LOGIN_QUERY, { username, password }, { token: null });
  const result = expectField<LoginResult>(data, "login");
  if (result.token) {
    // Persist token + expiry (epoch seconds) per CONTRACT.md row 16a.
    this.setLoginSession(result.token, result.expiresAt);
  }
  return result;
}

function logout(this: ScrolllerClient): void {
  this.setLoginSession(null, null);
}

async function me(this: ScrolllerClient): Promise<LoggedInUserResult> {
  this.requireAuth();
  const data = await this.request(GET_LOGGED_IN_USER_QUERY);
  return expectField<LoggedInUserResult>(data, "getLoggedInUser");
}

async function updateUser(this: ScrolllerClient, input: UpdateUserInput): Promise<boolean> {
  this.requireAuth();
  const data = await this.requestMutation(UPDATE_USER_MUTATION, { ...input });
  return expectField<boolean>(data, "updateUser");
}

async function updateInfo(this: ScrolllerClient): Promise<boolean> {
  this.requireAuth();
  const data = await this.requestMutation(UPDATE_INFO_MUTATION);
  return expectField<boolean>(data, "updateInfo");
}

async function markPostWithSound(this: ScrolllerClient, postId: number, hasAudio: boolean): Promise<boolean> {
  this.requireAuth();
  const data = await this.requestMutation(MARK_POST_WITH_SOUND_MUTATION, { postId, hasAudio });
  return expectField<boolean>(data, "addWithSound");
}

async function plans(this: ScrolllerClient): Promise<PlanResult[]> {
  // Public: PlanQuery works with "authorization": null (live-verified, T1 §2).
  const data = await this.request(PLAN_QUERY);
  return expectField<PlanResult[]>(data, "subscription_plans");
}

async function account(this: ScrolllerClient): Promise<AccountResult> {
  this.requireAuth();
  const data = await this.request(ACCOUNT_QUERY);
  return expectField<AccountResult>(data, "myAccount");
}

async function subscription(this: ScrolllerClient): Promise<SubscriptionResult> {
  this.requireAuth();
  const data = await this.request(SUBSCRIPTION_QUERY);
  return expectField<SubscriptionResult>(data, "mySubscription");
}

async function creatorReport(this: ScrolllerClient): Promise<CreatorReportResult> {
  this.requireAuth();
  const data = await this.request(GET_CREATOR_REPORT_QUERY);
  return expectField<CreatorReportResult>(data, "getCreatorReport");
}

async function revShare(this: ScrolllerClient): Promise<number | null> {
  this.requireAuth();
  const data = await this.request(GET_REV_SHARE_QUERY);
  return expectField<number | null>(data, "revShare");
}

/** PUT https://host8.scrolller.com/upload — multipart FormData with fields
 * `content` (the file), `file_key`, optional `blur`, optional `Authorization`
 * (the token); response JSON `{url, sourceSetId}` (T1 §9, chunk 04dk90lrwy2lz.js).
 * Shape notes: `file_key` carries the file name; `blur` is sent as "true"/"false".
 * Unverified live (requires an account) — implemented per the T1 report. */
async function uploadMedia(this: ScrolllerClient, source: UploadSource, options: { blur?: boolean } = {}): Promise<UploadResult> {
  const token = this.requireAuth();
  let bytes: Uint8Array;
  let fileName: string;
  if (source.path) {
    bytes = await readFile(source.path);
    fileName = source.fileName ?? path.basename(source.path);
  } else if (source.data) {
    bytes = source.data;
    fileName = source.fileName ?? "upload.bin";
  } else {
    throw new ScrolllerError("uploadMedia needs source.path or source.data");
  }

  const form = new UndiciFormData();
  form.append("content", new BufferFile([bytes], fileName));
  form.append("file_key", fileName);
  if (options.blur !== undefined) {
    form.append("blur", options.blur ? "true" : "false");
  }
  form.append("Authorization", token);

  const headers: Record<string, string> = { Accept: "*/*", Origin: ORIGIN };
  const userAgent = this.config.userAgent;
  if (userAgent) headers["User-Agent"] = userAgent;
  for (const [key, value] of Object.entries(this.config.extraHeaders)) {
    headers[key] = String(value);
  }

  let response: import("undici").Response;
  try {
    response = await undiciFetch(UPLOAD_URL, {
      method: "PUT",
      body: form,
      headers,
      dispatcher: this.dispatcher,
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
  } catch (error) {
    throw new ScrolllerError(`upload failed for ${UPLOAD_URL}: ${errorMessage(error)}`);
  }
  if (!response.ok) {
    throw new ScrolllerError(`upload failed: HTTP ${response.status} from ${UPLOAD_URL}`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new ScrolllerError(`upload returned invalid JSON: ${errorMessage(error)}`);
  }
  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    return body as UploadResult;
  }
  throw new ScrolllerError("upload returned an unexpected response body");
}

async function createCreatorPost(this: ScrolllerClient, input: CreatorPostInput): Promise<CreatorPostResult> {
  this.requireAuth();
  const data = await this.requestMutation(ADD_CREATOR_POST_MUTATION, { ...input });
  return expectField<CreatorPostResult>(data, "uploadPostToSubreddit");
}

ScrolllerClient.prototype.login = login;
ScrolllerClient.prototype.logout = logout;
ScrolllerClient.prototype.me = me;
ScrolllerClient.prototype.updateUser = updateUser;
ScrolllerClient.prototype.updateInfo = updateInfo;
ScrolllerClient.prototype.markPostWithSound = markPostWithSound;
ScrolllerClient.prototype.plans = plans;
ScrolllerClient.prototype.account = account;
ScrolllerClient.prototype.subscription = subscription;
ScrolllerClient.prototype.creatorReport = creatorReport;
ScrolllerClient.prototype.revShare = revShare;
ScrolllerClient.prototype.uploadMedia = uploadMedia;
ScrolllerClient.prototype.createCreatorPost = createCreatorPost;

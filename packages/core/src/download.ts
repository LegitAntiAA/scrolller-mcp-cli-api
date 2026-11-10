/** Media downloads (CONTRACT.md §7).
 *
 * - Source choice: videos prefer `fullLengthSource`; otherwise the largest
 *   `mediaSources` entry by width*height (list is small→large per RESEARCH.md §4).
 *   Literal "undefined"/"null" strings in source fields (backend artifact) are
 *   treated as absent.
 * - Filename: `<postId>-<slug or subreddit>-<WxH>.<ext>`; collisions get a
 *   numeric suffix; existing files are never overwritten.
 * - Progress via an `onProgress` callback (bytes/total when content-length is known).
 * - An audio sidecar is saved alongside as `<name>.audio.<ext>` when the post
 *   exposes an `audioSource`; merging is out of scope (operations phase).
 *
 * Downloads run through the client's dispatcher (so the proxy applies,
 * CONTRACT.md §4) and rely on its idle timeouts (headersTimeout/bodyTimeout) —
 * never on a total-request timeout, which would abort long streams.
 */
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { fetch as undiciFetch } from "undici";
import type { Dispatcher, Response as UndiciResponse } from "undici";
import { DownloadError, errorMessage, NotFoundError } from "./errors.js";
import { buildDispatcher } from "./proxy.js";
import { DEFAULT_TIMEOUT_MS, type DownloadProgress, type DownloadResult, type PostLike } from "./types.js";

const URL_DIMENSIONS = /(\d{1,5})x(\d{1,5})/g;
const FILENAME_INVALID = /[<>:"/\\|?*\u0000-\u001f]/g;
const WHITESPACE = /\s+/g;
const SLUG_MAX_LENGTH = 60;
const INVALID_SOURCE_STRINGS = new Set(["undefined", "null"]);

const TYPE_EXT: Record<string, string> = {
  WEBP: "webp",
  JPEG: "jpg",
  JPG: "jpg",
  PNG: "png",
  GIF: "gif",
  MP4: "mp4",
  WEBM: "webm",
  M3U8: "m3u8",
};

export type ProgressCallback = (progress: DownloadProgress) => void;

export interface NormalizedSource {
  url: string;
  width?: number | null;
  height?: number | null;
  type?: string | null;
}

export interface DownloadMediaOptions {
  onProgress?: ProgressCallback | null;
  /** Dispatcher (proxy-aware) shared with the client; a plain one is built and closed when absent. */
  dispatcher?: Dispatcher | null;
  timeoutMs?: number | null;
}

export interface DownloadToDirOptions extends DownloadMediaOptions {
  /** Parallel workers (CONTRACT.md §7: default 4). */
  concurrency?: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNumberOrNull(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Normalize a media source entry; scalar URLs become `{url}`. Literal "undefined"/"null" strings are treated as absent. */
function asSource(value: unknown): NormalizedSource | null {
  if (typeof value === "string") {
    return value && !INVALID_SOURCE_STRINGS.has(value) ? { url: value } : null;
  }
  if (isRecord(value)) {
    const url = value.url;
    if (typeof url === "string" && url && !INVALID_SOURCE_STRINGS.has(url)) {
      return {
        url,
        width: asNumberOrNull(value.width),
        height: asNumberOrNull(value.height),
        type: typeof value.type === "string" ? value.type : null,
      };
    }
  }
  return null;
}

function areaOf(source: NormalizedSource): number {
  return Math.max(0, Math.trunc(source.width ?? 0)) * Math.max(0, Math.trunc(source.height ?? 0));
}

/** Pick the download source for a post (CONTRACT.md §7): videos prefer `fullLengthSource`, else the largest `mediaSources` entry by area. */
export function bestMediaSource(post: PostLike): NormalizedSource {
  const fullLength = asSource(post.fullLengthSource);
  if (fullLength) return fullLength;
  const candidates: NormalizedSource[] = [];
  const raw = post.mediaSources;
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const source = asSource(entry);
      if (source) candidates.push(source);
    }
  }
  if (candidates.length === 0) {
    throw new DownloadError("post has no usable media sources");
  }
  return candidates.reduce((best, source) => (areaOf(source) > areaOf(best) ? source : best));
}

function audioSourceOf(post: PostLike): NormalizedSource | null {
  return asSource(post.audioSource);
}

function positiveInt(value: number | null | undefined): number {
  return value !== null && value !== undefined && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function extensionOf(source: NormalizedSource, fallback: string): string {
  const clean = (source.url.split("?")[0] ?? source.url).split("#")[0] ?? source.url;
  const lastSegment = clean.split("/").pop() ?? "";
  const dot = lastSegment.lastIndexOf(".");
  if (dot >= 0) {
    const ext = lastSegment.slice(dot + 1).toLowerCase();
    if (/^[a-z0-9]{1,5}$/.test(ext)) return ext;
  }
  return TYPE_EXT[(source.type ?? "").toUpperCase()] ?? fallback;
}

function dimensionsOf(source: NormalizedSource): [number, number] {
  let width = positiveInt(source.width);
  let height = positiveInt(source.height);
  if (!width || !height) {
    // Original URLs embed the size: ...-<reddit-id>-WxH.ext (RESEARCH.md §4).
    const clean = source.url.split("?")[0] ?? source.url;
    for (const match of clean.matchAll(URL_DIMENSIONS)) {
      const parsedWidth = Number.parseInt(match[1] ?? "", 10);
      const parsedHeight = Number.parseInt(match[2] ?? "", 10);
      if (parsedWidth > 0) width = parsedWidth;
      if (parsedHeight > 0) height = parsedHeight;
    }
  }
  return [width, height];
}

function slugOf(post: PostLike): string {
  const url = typeof post.url === "string" ? post.url : "";
  let candidate = url ? ((url.split("?")[0] ?? url).replace(/\/+$/, "").split("/").pop() ?? "") : "";
  if (!candidate) {
    candidate =
      typeof post.subredditTitle === "string"
        ? post.subredditTitle
        : typeof post.subredditUrl === "string"
          ? post.subredditUrl
          : "";
  }
  const cleaned = candidate
    .trim()
    .replace(FILENAME_INVALID, "-")
    .replace(WHITESPACE, "-")
    .replace(/^[-. ]+|[-. ]+$/g, "");
  return cleaned.slice(0, SLUG_MAX_LENGTH) || "post";
}

function postIdOf(post: PostLike): string {
  return post.id ? String(post.id) : "post";
}

/** Expand a leading `~` to the user home (config download_dir may be `~/Downloads/scrolller`, CONTRACT.md §3). */
function expandHome(dirPath: string): string {
  if (dirPath === "~") return homedir();
  if (dirPath.startsWith("~/") || dirPath.startsWith("~\\")) return path.join(homedir(), dirPath.slice(2));
  return dirPath;
}

/** First non-existing `<stem>.<ext>`, `<stem>-1.<ext>`, ... — never overwrites (CONTRACT.md §7). */
function resolveFreePath(targetDir: string, stem: string, ext: string): string {
  let candidate = path.join(targetDir, `${stem}.${ext}`);
  let index = 1;
  while (existsSync(candidate)) {
    candidate = path.join(targetDir, `${stem}-${index}.${ext}`);
    index += 1;
  }
  return candidate;
}

async function removeFileIfExists(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // nothing to clean up
  }
}

async function streamToFile(
  dispatcher: Dispatcher,
  url: string,
  filePath: string,
  opts: { postId: string; onProgress: ProgressCallback | null },
): Promise<void> {
  let response: UndiciResponse;
  try {
    response = await undiciFetch(url, { dispatcher, redirect: "follow" });
  } catch (error) {
    throw new DownloadError(`download failed for ${url}: ${errorMessage(error)}`);
  }
  const write = createWriteStream(filePath);
  let bytesDone = 0;
  try {
    if (response.status === 404) {
      throw new NotFoundError(`media not found (HTTP 404): ${url}`);
    }
    if (response.status >= 400) {
      throw new DownloadError(`HTTP ${response.status} fetching ${url}`);
    }
    if (!response.body) {
      throw new DownloadError(`empty response body for ${url}`);
    }
    const lengthHeader = response.headers.get("content-length");
    const bytesTotal = lengthHeader && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : null;
    for await (const chunk of response.body) {
      const bytes = chunk as Uint8Array;
      bytesDone += bytes.byteLength;
      if (!write.write(bytes)) {
        await once(write, "drain");
      }
      opts.onProgress?.({ postId: opts.postId, url, bytesDone, bytesTotal, path: filePath, done: false });
    }
    write.end();
    await once(write, "finish");
    opts.onProgress?.({ postId: opts.postId, url, bytesDone, bytesTotal, path: filePath, done: true });
  } catch (error) {
    write.destroy();
    await removeFileIfExists(filePath); // never leave a partial file behind
    if (error instanceof NotFoundError || error instanceof DownloadError) throw error;
    throw new DownloadError(`download failed for ${url}: ${errorMessage(error)}`);
  }
}

/** Download a post's best media source into `targetDir`; returns the saved path.
 *
 * `post` must be a post object; URL/id refs are resolved by the operation
 * methods in a later phase.
 */
export async function downloadMedia(post: PostLike, targetDir: string, options: DownloadMediaOptions = {}): Promise<string> {
  if (!isRecord(post)) {
    throw new DownloadError("downloadMedia needs a post object; URL/id refs will be resolved by the operation methods");
  }

  const source = bestMediaSource(post);
  const audio = audioSourceOf(post);
  const postId = postIdOf(post);
  const [width, height] = dimensionsOf(source);
  const stem = `${postId}-${slugOf(post)}-${width}x${height}`;

  const target = expandHome(targetDir);
  try {
    mkdirSync(target, { recursive: true });
  } catch (error) {
    throw new DownloadError(`cannot create download directory ${target}: ${errorMessage(error)}`);
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ownedDispatcher = options.dispatcher ? null : buildDispatcher(null, { timeoutMs });
  const dispatcher = options.dispatcher ?? ownedDispatcher!;
  try {
    const mainPath = resolveFreePath(target, stem, extensionOf(source, "jpg"));
    await streamToFile(dispatcher, source.url, mainPath, { postId, onProgress: options.onProgress ?? null });
    if (audio) {
      const audioPath = resolveFreePath(target, `${stem}.audio`, extensionOf(audio, "mp3"));
      await streamToFile(dispatcher, audio.url, audioPath, { postId, onProgress: options.onProgress ?? null });
    }
    return mainPath;
  } finally {
    if (ownedDispatcher) {
      try {
        await ownedDispatcher.close();
      } catch {
        // ignore dispatcher shutdown failures
      }
    }
  }
}

/** Download many posts concurrently with a small worker pool; one result per post.
 *
 * Failures are reported per item (`DownloadResult.error`), never lost.
 * `onProgress` fires from concurrent workers and should be safe to interleave.
 */
export async function downloadToDir(
  posts: PostLike | PostLike[],
  targetDir: string,
  options: DownloadToDirOptions = {},
): Promise<DownloadResult[]> {
  const items = Array.isArray(posts) ? posts : [posts];
  const concurrency = Math.max(1, Math.trunc(options.concurrency ?? 4));
  const results: DownloadResult[] = new Array(items.length);
  let next = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      const post = items[index] as PostLike;
      const fallbackId = postIdOf(post);
      try {
        const savedPath = await downloadMedia(post, targetDir, options);
        results[index] = { postId: fallbackId, path: savedPath, error: null };
      } catch (error) {
        results[index] = { postId: fallbackId, path: null, error: errorMessage(error) };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

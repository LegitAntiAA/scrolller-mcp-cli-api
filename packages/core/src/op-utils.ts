/** Small shared helpers for the operation methods. */
import { NetworkError } from "./errors.js";

/** Extract a named field of a GraphQL `data` response; throws when the shape is unexpected. */
export function expectField<T>(data: unknown, key: string): T {
  if (data !== null && typeof data === "object" && !Array.isArray(data) && key in data) {
    return (data as Record<string, unknown>)[key] as T;
  }
  throw new NetworkError(`unexpected API response shape: missing field "${key}"`);
}

/** Canonical subreddit URL form used by the API responses (`/r/<name>`). Accepts
 * `aww`, `/r/aww`, `/aww`, or an absolute scrolller.com URL. */
export function toSubredditUrl(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "/r/";
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).pathname.replace(/\/+$/, "") || "/";
    } catch {
      return trimmed;
    }
  }
  if (trimmed.startsWith("/r/")) return trimmed.replace(/\/+$/, "");
  if (trimmed.startsWith("/")) return `/r${trimmed.replace(/\/+$/, "")}`;
  return `/r/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

/** True when the value is a bare integer string ("123") usable as a numeric id. */
export function isNumericId(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

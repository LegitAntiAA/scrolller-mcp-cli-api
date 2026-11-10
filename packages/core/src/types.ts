/** Shared types for the Scrolller client (CONTRACT.md §1–§5, §7). Zero runtime dependencies. */

export const DEFAULT_BASE_URL = "https://api.scrolller.com/admin";
export const DEFAULT_TIMEOUT_MS = 30000;
export const DEFAULT_READ_RETRIES = 1;

/** NsfwFilter GraphQL enum (RESEARCH.md §2). Default everywhere: SFW (CONTRACT.md §1). */
export type NsfwFilter = "SFW" | "NSFW" | "ALL";
export const NSFW_FILTERS: readonly NsfwFilter[] = ["SFW", "NSFW", "ALL"];

/** Proxy transport types (CONTRACT.md §4). */
export type ProxyType = "http" | "https" | "socks4" | "socks5";
export const PROXY_TYPES: readonly ProxyType[] = ["http", "https", "socks4", "socks5"];

export interface ProxyConfig {
  type: ProxyType;
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
}

/** Normalized error kinds (CONTRACT.md §5). */
export type ErrorKind =
  | "AUTH_REQUIRED"
  | "INVALID_CREDENTIALS"
  | "INVALID_TOKEN"
  | "GRAPHQL_ERROR"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "PROXY_ERROR"
  | "NOT_FOUND"
  | "DOWNLOAD_ERROR";

/** One entry of the GraphQL `errors[]` list (RESEARCH.md §1). */
export interface GraphQLResponseError {
  message?: string | null;
  extensions?: { code?: string | null; [key: string]: unknown } | null;
}

/** Loose media source entry as returned by the API (RESEARCH.md §4). */
export interface MediaSource {
  url?: string | null;
  width?: number | string | null;
  height?: number | string | null;
  isOptimized?: boolean | null;
  type?: string | null;
}

/**
 * Loose post object accepted by the download helpers; the typed post model
 * arrives with the operation-methods phase.
 */
export type PostLike = Record<string, unknown>;

/** Progress event emitted while streaming a media file (CONTRACT.md §7). */
export interface DownloadProgress {
  postId: string;
  url: string;
  bytesDone: number;
  bytesTotal: number | null;
  path?: string | null;
  done: boolean;
}

/** Per-item outcome of `downloadToDir` (CONTRACT.md §7). */
export interface DownloadResult {
  postId: string;
  path?: string | null;
  error?: string | null;
}

/** Effective client configuration (CONTRACT.md §2 options + §3 file values). */
export interface ScrolllerClientOptions {
  token: string | null;
  nsfw: NsfwFilter;
  /** null = use the bundled realistic browser UA (transport `DEFAULT_USER_AGENT`). */
  userAgent: string | null;
  extraHeaders: Record<string, string>;
  proxy: ProxyConfig | null;
  timeoutMs: number;
  baseUrl: string;
  downloadDir: string | null;
  readRetries: number;
  /** Config file the values were resolved from; setToken/setProxy persist back to it (CONTRACT.md §3). */
  configPath: string;
}

/** Constructor overrides; null/undefined means "not set" and falls through env > config file > defaults. */
export interface ScrolllerClientInput {
  token?: string | null;
  nsfw?: string | null;
  userAgent?: string | null;
  extraHeaders?: Record<string, string> | null;
  /** ProxyConfig object, `type://[user:pass@]host:port` URL string, or null (no proxy). */
  proxy?: string | ProxyConfig | null;
  timeoutMs?: number | string | null;
  baseUrl?: string | null;
  downloadDir?: string | null;
  readRetries?: number | string | null;
  configPath?: string | null;
}

/** Config file shape (CONTRACT.md §3, snake_case keys). */
export interface ScrolllerConfigFile {
  token?: string | null;
  nsfw?: string | null;
  user_agent?: string | null;
  extra_headers?: Record<string, string> | null;
  proxy?: ProxyConfig | null;
  download_dir?: string | null;
  timeout_ms?: number | string | null;
}

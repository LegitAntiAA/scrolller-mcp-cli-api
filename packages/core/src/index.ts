/** Scrolller API client library (unofficial) — transport foundation.
 *
 * The operation methods (CONTRACT.md §6) arrive in a later phase on top of
 * `request`. See docs/api/CONTRACT.md for the canonical operation list shared
 * by all language implementations.
 */
import type { Dispatcher } from "undici";
import { buildClientOptions, defaultConfigPath, loadConfigFile, saveConfigFile } from "./config.js";
import { downloadMedia } from "./download.js";
import type { DownloadMediaOptions, ProgressCallback } from "./download.js";
import { DownloadError } from "./errors.js";
import { asProxyConfig, buildDispatcher, proxyConfigToDict } from "./proxy.js";
import { graphqlRequest } from "./transport.js";
import type { GraphQLRequestInput, RequestContext } from "./transport.js";
import type { PostLike, ProxyConfig, ScrolllerClientInput, ScrolllerClientOptions } from "./types.js";

export const VERSION = "0.1.0";

/** Persist one value back to the client's config file, preserving the rest of the file (CONTRACT.md §3). */
function persistConfigValue(options: ScrolllerClientOptions, key: string, value: unknown): void {
  const filePath = options.configPath || defaultConfigPath();
  const fileConfig = loadConfigFile(filePath);
  fileConfig[key] = value;
  saveConfigFile(filePath, fileConfig);
}

export interface RequestOptions {
  isMutation?: boolean;
  omitNullVariables?: boolean;
}

/** Minimal Scrolller client (transport foundation). */
export class ScrolllerClient {
  private readonly _options: ScrolllerClientOptions;
  private _dispatcher: Dispatcher;

  constructor(input: ScrolllerClientInput = {}) {
    this._options = buildClientOptions(input);
    this._dispatcher = buildDispatcher(this._options.proxy, { timeoutMs: this._options.timeoutMs });
  }

  /** The effective client configuration (CONTRACT.md §2). */
  get config(): ScrolllerClientOptions {
    return this._options;
  }

  /** Execute one GraphQL request; returns the response `data` field.
   *
   * Optional filter variables that are null/undefined are omitted from the
   * payload by default (see transport `GraphQLRequestInput.omitNullVariables`).
   */
  request(query: string, variables?: Record<string, unknown> | null, options: RequestOptions = {}): Promise<unknown> {
    const input: GraphQLRequestInput = {
      query,
      variables,
      token: this._options.token,
      isMutation: options.isMutation,
      omitNullVariables: options.omitNullVariables,
    };
    const ctx: RequestContext = {
      baseUrl: this._options.baseUrl,
      userAgent: this._options.userAgent,
      extraHeaders: this._options.extraHeaders,
      timeoutMs: this._options.timeoutMs,
      readRetries: this._options.readRetries,
      dispatcher: this._dispatcher,
    };
    return graphqlRequest(input, ctx);
  }

  /** Set or clear the auth token; persists to the config file (CONTRACT.md §6 row 16). */
  setToken(token: string | null): void {
    this._options.token = token;
    persistConfigValue(this._options, "token", token);
  }

  /** Replace the active proxy (ProxyConfig, `type://[user:pass@]host:port` URL, or null to clear) and persist it to the config file (CONTRACT.md §4). */
  setProxy(proxy: string | ProxyConfig | null): void {
    const config = asProxyConfig(proxy);
    this._options.proxy = config;
    this._dispatcher = buildDispatcher(config, { timeoutMs: this._options.timeoutMs });
    persistConfigValue(this._options, "proxy", config ? proxyConfigToDict(config) : null);
  }

  /** Download a post's best media source; returns the saved path (CONTRACT.md §7).
   *
   * Without `dir` the configured `download_dir` is used; it must be set
   * somewhere (option, env, config file).
   */
  async download(
    post: PostLike,
    dir?: string | null,
    options: { onProgress?: ProgressCallback | null } = {},
  ): Promise<string> {
    const target = dir ?? this._options.downloadDir;
    if (!target) {
      throw new DownloadError("no download directory given (pass dir or set download_dir)");
    }
    const mediaOptions: DownloadMediaOptions = {
      onProgress: options.onProgress ?? null,
      dispatcher: this._dispatcher,
      timeoutMs: this._options.timeoutMs,
    };
    return downloadMedia(post, target, mediaOptions);
  }
}

export { bestMediaSource, downloadMedia, downloadToDir } from "./download.js";
export type { DownloadMediaOptions, DownloadToDirOptions, NormalizedSource, ProgressCallback } from "./download.js";
export {
  buildClientOptions,
  defaultConfigPath,
  deepMerge,
  loadConfigFile,
  saveConfigFile,
  updateConfigFile,
} from "./config.js";
export { CONFIG_DIR_NAME, CONFIG_FILE_NAME, DEFAULT_CONFIG, parseExtraHeaders, applyEnvOverrides, resolveConfig } from "./config.js";
export { asProxyConfig, buildDispatcher, parseProxyUrl, proxyConfigToDict } from "./proxy.js";
export { DEFAULT_USER_AGENT, graphqlRequest, omitNullVariables, ORIGIN, requestHeaders } from "./transport.js";
export type { GraphQLRequestInput, RequestContext } from "./transport.js";
export {
  AuthRequiredError,
  DownloadError,
  GraphQLError,
  InvalidCredentialsError,
  InvalidTokenError,
  NetworkError,
  NotFoundError,
  ProxyError,
  RateLimitedError,
  ScrolllerError,
} from "./errors.js";
export type { GraphQLErrorInit, ScrolllerErrorInit } from "./errors.js";
export { DEFAULT_BASE_URL, DEFAULT_READ_RETRIES, DEFAULT_TIMEOUT_MS, NSFW_FILTERS, PROXY_TYPES } from "./types.js";
export type {
  DownloadProgress,
  DownloadResult,
  ErrorKind,
  GraphQLResponseError,
  MediaSource,
  NsfwFilter,
  PostLike,
  ProxyConfig,
  ProxyType,
  ScrolllerClientInput,
  ScrolllerClientOptions,
  ScrolllerConfigFile,
} from "./types.js";

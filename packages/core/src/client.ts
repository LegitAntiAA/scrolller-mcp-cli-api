/** ScrolllerClient — transport core (T4-phase1) + auth fail-fast + NSFW default.
 *
 * The operation methods (CONTRACT.md §6) live in `src/ops/*` and are attached
 * to `ScrolllerClient.prototype` there; the method signatures are declared by
 * the `ScrolllerOps` interface (op-types.ts) merged into this class via
 * `interface ScrolllerClient extends ScrolllerOps {}`. Import the package root
 * (index.ts) so every ops module is loaded.
 */
import type { Dispatcher } from "undici";
import { buildClientOptions, defaultConfigPath, loadConfigFile, saveConfigFile } from "./config.js";
import { downloadMedia } from "./download.js";
import type { DownloadMediaOptions, ProgressCallback } from "./download.js";
import { AuthRequiredError, DownloadError } from "./errors.js";
import { asProxyConfig, buildDispatcher, proxyConfigToDict } from "./proxy.js";
import { graphqlRequest } from "./transport.js";
import type { GraphQLRequestInput, RequestContext } from "./transport.js";
import type { NsfwFilter, PostLike, ProxyConfig, ScrolllerClientInput, ScrolllerClientOptions } from "./types.js";
import type { ScrolllerOps } from "./op-types.js";

export const VERSION = "0.1.0";

/** Guidance text for AUTH_REQUIRED (CONTRACT.md §5.1), shared by all library surfaces. */
export const AUTH_REQUIRED_MESSAGE =
  "Authentication required. Call client.login(username, password), pass token to new ScrolllerClient({ token: \"...\" }), or run: scrolller login / scrolller token <token>";

/** Persist values back to the client's config file, preserving the rest of the file (CONTRACT.md §3). */
function persistConfigValues(options: ScrolllerClientOptions, patch: Record<string, unknown>): void {
  const filePath = options.configPath || defaultConfigPath();
  const fileConfig = loadConfigFile(filePath);
  Object.assign(fileConfig, patch);
  saveConfigFile(filePath, fileConfig);
}

export interface RequestOptions {
  isMutation?: boolean;
  omitNullVariables?: boolean;
  /** Explicit token override (null = send "authorization": null, e.g. for login). */
  token?: string | null;
}

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

  /** True when a token is configured (constructor, env or config file). */
  hasToken(): boolean {
    return Boolean(this._options.token);
  }

  /** Fail-fast guard for 🔒 operations (CONTRACT.md §5.1): throws
   * AuthRequiredError BEFORE any network call when no token is configured. */
  requireAuth(): string {
    const token = this._options.token;
    if (!token) {
      throw new AuthRequiredError(AUTH_REQUIRED_MESSAGE);
    }
    return token;
  }

  /** The NSFW filter for read operations: explicit option wins, else the client config (default SFW). @internal */
  effectiveNsfw(nsfw?: NsfwFilter | null): NsfwFilter {
    return nsfw ?? this._options.nsfw;
  }

  /** The proxy-aware dispatcher for non-GraphQL HTTP (agent routes, upload). @internal */
  get dispatcher(): Dispatcher {
    return this._dispatcher;
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
      token: options.token !== undefined ? options.token : this._options.token,
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

  /** Execute one mutation (no read-retries). */
  requestMutation(query: string, variables?: Record<string, unknown> | null, options: RequestOptions = {}): Promise<unknown> {
    return this.request(query, variables, { ...options, isMutation: true });
  }

  /** Set or clear the auth token; persists to the config file (CONTRACT.md §6 row 16). */
  setToken(token: string | null): void {
    this._options.token = token;
    persistConfigValues(this._options, { token });
  }

  /** Set/clear the whole login session: the token AND its expiry
   * (LoginQuery.expiresAt, epoch seconds) both persist to the config file
   * (CONTRACT.md row 16a). Used by login/logout in ops/account.ts. @internal */
  setLoginSession(token: string | null, expiresAt?: number | string | null): void {
    this._options.token = token;
    persistConfigValues(this._options, { token, expires_at: expiresAt ?? null });
  }

  /** Replace the active proxy (ProxyConfig, `type://[user:pass@]host:port` URL, or null to clear) and persist it to the config file (CONTRACT.md §4). */
  setProxy(proxy: string | ProxyConfig | null): void {
    const config = asProxyConfig(proxy);
    this._options.proxy = config;
    this._dispatcher = buildDispatcher(config, { timeoutMs: this._options.timeoutMs });
    persistConfigValues(this._options, { proxy: config ? proxyConfigToDict(config) : null });
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

/** Operation-method surface merged onto the class (implemented in src/ops/*). */
export interface ScrolllerClient extends ScrolllerOps {}

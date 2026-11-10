/** Scrolller API client library (unofficial) — transport + all operations.
 *
 * `ScrolllerClient` bundles the transport core (client.ts) with the operation
 * methods implemented in `src/ops/*` (attached to the prototype on import —
 * always import this package root). See docs/api/CONTRACT.md for the canonical
 * operation list and docs/api/T1-RESEARCH-FULL.md for the verbatim protocol.
 */
// Operation modules — prototype side effects. Keep these first so every
// ScrolllerClient instance is fully populated as soon as the package loads.
import "./ops/feed.js";
import "./ops/posts.js";
import "./ops/comments.js";
import "./ops/collections.js";
import "./ops/social.js";
import "./ops/account.js";
import "./ops/messaging.js";
import "./ops/agent.js";

export { VERSION, ScrolllerClient, AUTH_REQUIRED_MESSAGE } from "./client.js";
export type { RequestOptions } from "./client.js";
export { UPLOAD_URL } from "./ops/account.js";
export { AGENT_ORIGIN } from "./ops/agent.js";

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
  isExhaustedCursor,
  iteratedPages,
  listFromPages,
  pagedByIndex,
  pagedByLastId,
  pagedByPageNumber,
} from "./paging.js";
export type { IteratedPage } from "./paging.js";
export { expectField, isNumericId, toSubredditUrl } from "./op-utils.js";

// Verbatim SDL documents (T1-RESEARCH-FULL.md) — re-exported for advanced use.
export * from "./queries.js";

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
  errorMessage,
} from "./errors.js";
export type { GraphQLErrorInit, ScrolllerErrorInit } from "./errors.js";
export {
  DEFAULT_BASE_URL,
  DEFAULT_READ_RETRIES,
  DEFAULT_TIMEOUT_MS,
  GALLERY_FILTERS,
  GALLERY_SORT_BYS,
  NSFW_FILTERS,
  PROXY_TYPES,
} from "./types.js";
export type {
  DownloadProgress,
  DownloadResult,
  ErrorKind,
  GalleryFilter,
  GallerySortBy,
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
export * from "./op-types.js";

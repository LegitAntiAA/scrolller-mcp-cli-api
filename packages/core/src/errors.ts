/** Normalized error hierarchy (CONTRACT.md §5).
 *
 * Every error derives from `ScrolllerError` and carries a stable `kind`
 * (ErrorKind), an optional `httpStatus` and optional `details`. GraphQL-sourced
 * errors preserve the API `errors[]` list.
 */
import type { ErrorKind, GraphQLResponseError } from "./types.js";

/** Extract a human-readable message from an unknown thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface ScrolllerErrorInit {
  httpStatus?: number | null;
  details?: Record<string, unknown>;
  /** Underlying cause (standard Error `cause`), preserved for diagnostics. */
  cause?: unknown;
  /** Overrides the class default kind (rarely needed). */
  kind?: ErrorKind;
}

export class ScrolllerError extends Error {
  readonly kind: ErrorKind | null;
  readonly httpStatus: number | null;
  readonly details: Record<string, unknown>;

  constructor(message: string, init: ScrolllerErrorInit = {}) {
    super(message, { cause: init.cause });
    this.name = this.constructor.name;
    this.kind = init.kind ?? null;
    this.httpStatus = init.httpStatus ?? null;
    this.details = init.details ?? {};
  }
}

/** An auth-required operation was attempted without a token. Raised fail-fast (before any network call) by the operation methods in a later phase. */
export class AuthRequiredError extends ScrolllerError {
  constructor(message: string, init: ScrolllerErrorInit = {}) {
    super(message, { ...init, kind: "AUTH_REQUIRED" });
  }
}

export interface GraphQLErrorInit extends ScrolllerErrorInit {
  errors?: GraphQLResponseError[] | null;
}

/** The API returned a GraphQL `errors[]` list (or an unexpected HTTP status). */
export class GraphQLError extends ScrolllerError {
  /** The API `errors[]` list (CONTRACT.md §5). */
  readonly errors: GraphQLResponseError[];

  constructor(message: string, init: GraphQLErrorInit = {}) {
    super(message, { ...init, kind: init.kind ?? "GRAPHQL_ERROR" });
    this.errors = init.errors ?? [];
  }
}

/** The API rejected the supplied token (UNAUTHENTICATED/FORBIDDEN). */
export class InvalidTokenError extends GraphQLError {
  constructor(message: string, init: GraphQLErrorInit = {}) {
    super(message, { ...init, kind: "INVALID_TOKEN" });
  }
}

/** Login rejected the credentials (server signals via a generic INTERNAL_SERVER_ERROR code and message, RESEARCH.md §3a). */
export class InvalidCredentialsError extends GraphQLError {
  constructor(message: string, init: GraphQLErrorInit = {}) {
    super(message, { ...init, kind: "INVALID_CREDENTIALS" });
  }
}

/** The API answered HTTP 429. */
export class RateLimitedError extends ScrolllerError {
  constructor(message: string, init: ScrolllerErrorInit = {}) {
    super(message, { ...init, kind: "RATE_LIMITED" });
  }
}

/** Connection failure, timeout, or unusable HTTP response. */
export class NetworkError extends ScrolllerError {
  constructor(message: string, init: ScrolllerErrorInit = {}) {
    super(message, { ...init, kind: "NETWORK_ERROR" });
  }
}

/** Proxy misconfiguration or proxy connection failure. */
export class ProxyError extends ScrolllerError {
  constructor(message: string, init: ScrolllerErrorInit = {}) {
    super(message, { ...init, kind: "PROXY_ERROR" });
  }
}

/** HTTP 404 from the API or a media host. */
export class NotFoundError extends ScrolllerError {
  constructor(message: string, init: ScrolllerErrorInit = {}) {
    super(message, { ...init, kind: "NOT_FOUND" });
  }
}

/** A media download could not be completed. */
export class DownloadError extends ScrolllerError {
  constructor(message: string, init: ScrolllerErrorInit = {}) {
    super(message, { ...init, kind: "DOWNLOAD_ERROR" });
  }
}

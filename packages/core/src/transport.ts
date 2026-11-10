/** GraphQL transport (RESEARCH.md §1, CONTRACT.md §1).
 *
 * POSTs `{"query": ..., "variables": ..., "authorization": token|null}` to the
 * API endpoint — the token is a **body field**, not a header. Responses are
 * classified into the normalized errors of CONTRACT.md §5. Idempotent reads
 * retry once on 5xx/network errors (configurable); mutations never retry.
 */
import { fetch as undiciFetch } from "undici";
import type { Dispatcher, Response as UndiciResponse } from "undici";
import {
  errorMessage,
  GraphQLError,
  InvalidCredentialsError,
  InvalidTokenError,
  NetworkError,
  NotFoundError,
  ProxyError,
  RateLimitedError,
  ScrolllerError,
} from "./errors.js";
import { DEFAULT_BASE_URL, DEFAULT_READ_RETRIES, DEFAULT_TIMEOUT_MS, type GraphQLResponseError } from "./types.js";

export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
export const ORIGIN = "https://scrolller.com";

const AUTH_ERROR_CODES = new Set(["UNAUTHENTICATED", "FORBIDDEN"]);
/** The server reports wrong login credentials with this exact message under a generic INTERNAL_SERVER_ERROR code (RESEARCH.md §3a) — match by message. */
const INVALID_CREDENTIALS_MESSAGE = "Username or password is incorrect";

export interface RequestContext {
  baseUrl?: string | null;
  userAgent?: string | null;
  extraHeaders?: Record<string, string> | null;
  timeoutMs?: number | null;
  readRetries?: number | null;
  dispatcher?: Dispatcher | null;
}

export interface GraphQLRequestInput {
  query: string;
  variables?: Record<string, unknown> | null;
  token?: string | null;
  isMutation?: boolean;
  /**
   * Drop undefined/null entries from `variables` before sending (default true).
   * Verified live: explicit nulls for the nullable filter variables ($filter,
   * $includeFilters, $excludeFilters) make the server answer HTTP 200
   * INTERNAL_SERVER_ERROR; omitting them is safe ($iterator: null is accepted
   * too, so dropping nulls is uniformly safe). Pass false only when an
   * operation must send an explicit null.
   */
  omitNullVariables?: boolean;
}

/** Remove undefined/null entries from a variables object. */
export function omitNullVariables(variables: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(variables)) {
    if (value === undefined || value === null) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

export function requestHeaders(
  userAgent?: string | null,
  extraHeaders?: Record<string, string> | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "*/*",
    Origin: ORIGIN,
    "User-Agent": userAgent || DEFAULT_USER_AGENT,
  };
  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      headers[key] = String(value);
    }
  }
  return headers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

/** Map a fetch/transport failure to ProxyError when it originates from our SOCKS connector (undici may wrap it), else NetworkError. */
function toTransportError(error: unknown, timeoutMs: number): ScrolllerError {
  for (let current: unknown = error, depth = 0; depth < 4; depth += 1) {
    if (current instanceof ProxyError) return current;
    current = isRecord(current) ? current.cause : undefined;
  }
  if (isTimeoutError(error)) {
    return new NetworkError(`timeout after ${timeoutMs}ms calling Scrolller API`);
  }
  return new NetworkError(`network error calling Scrolller API: ${errorMessage(error)}`);
}

async function extractGraphqlErrors(response: UndiciResponse): Promise<GraphQLResponseError[]> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && Array.isArray(body.errors)) {
      return body.errors as GraphQLResponseError[];
    }
  } catch {
    // best effort — a body we cannot parse contributes no error entries
  }
  return [];
}

function raiseForGraphqlErrors(errors: GraphQLResponseError[], httpStatus?: number): never {
  const first = errors[0] ?? {};
  const rawMessage = typeof first.message === "string" ? first.message : "";
  const code = typeof first.extensions?.code === "string" ? first.extensions.code : "";
  const message = rawMessage ? (code ? `${rawMessage} [code=${code}]` : rawMessage) : "GraphQL error";
  if (AUTH_ERROR_CODES.has(code)) {
    throw new InvalidTokenError(message, { errors, httpStatus });
  }
  if (rawMessage.trim() === INVALID_CREDENTIALS_MESSAGE) {
    throw new InvalidCredentialsError(message, { errors, httpStatus });
  }
  throw new GraphQLError(message, { errors, httpStatus });
}

/** Classify one non-5xx response: return the GraphQL `data` field or raise. */
async function interpretResponse(response: UndiciResponse): Promise<unknown> {
  const status = response.status;
  if (status === 429) {
    throw new RateLimitedError("rate limited (HTTP 429)", { httpStatus: 429 });
  }
  if (status === 404) {
    throw new NotFoundError("endpoint not found (HTTP 404)", { httpStatus: 404 });
  }
  if (status >= 400) {
    const errors = await extractGraphqlErrors(response);
    if (errors.length > 0) raiseForGraphqlErrors(errors, status);
    throw new GraphQLError(`HTTP ${status} from Scrolller API`, { httpStatus: status });
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new NetworkError(`invalid JSON in API response: ${errorMessage(error)}`);
  }
  if (!isRecord(body)) {
    throw new NetworkError("unexpected non-object API response body");
  }
  const errors = body.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    raiseForGraphqlErrors(errors as GraphQLResponseError[], status);
  }
  return body.data;
}

/** Execute one GraphQL request; returns the response `data` field. */
export async function graphqlRequest(input: GraphQLRequestInput, ctx: RequestContext = {}): Promise<unknown> {
  const variables = input.variables
    ? input.omitNullVariables ?? true
      ? omitNullVariables(input.variables)
      : { ...input.variables }
    : {};
  const payload = JSON.stringify({
    query: input.query,
    variables,
    authorization: input.token ?? null,
  });
  const headers = requestHeaders(ctx.userAgent, ctx.extraHeaders);
  const baseUrl = ctx.baseUrl || DEFAULT_BASE_URL;
  const timeoutMs = ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = input.isMutation ? 1 : 1 + Math.max(0, Math.trunc(ctx.readRetries ?? DEFAULT_READ_RETRIES));

  for (let attempt = 1; ; attempt += 1) {
    let response: UndiciResponse;
    try {
      response = await undiciFetch(baseUrl, {
        method: "POST",
        headers,
        body: payload,
        dispatcher: ctx.dispatcher ?? undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const mapped = toTransportError(error, timeoutMs);
      if (attempt >= maxAttempts) throw mapped;
      continue; // idempotent reads retry once on network errors
    }
    if (response.status >= 500) {
      if (attempt >= maxAttempts) {
        const errors = await extractGraphqlErrors(response);
        if (errors.length > 0) raiseForGraphqlErrors(errors, response.status);
        throw new NetworkError(`HTTP ${response.status} from Scrolller API`, { httpStatus: response.status });
      }
      continue; // idempotent reads retry once on 5xx
    }
    return await interpretResponse(response);
  }
}

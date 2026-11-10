/** Official agent routes (CONTRACT.md §6 row 30; RESEARCH.md §4b — live-verified).
 *
 * Plain GET JSON on scrolller.com/agent/* (NOT GraphQL): `/agent/subreddit/{slug}`,
 * `/agent/content/{slug}`, `/agent/collection/{id}`. Embed-safe by design —
 * the payload has NO raw media URLs, only embedHtml/embedUrl/source permalink.
 * Public (no token). Server-side rate limit ~1 req/s per IP (429 on bursts);
 * responses are cached ≤10 min. Content is addressed by slug (numeric content
 * ids → 404).
 */
import { fetch as undiciFetch } from "undici";
import type { Response as UndiciResponse } from "undici";
import { ScrolllerClient } from "../client.js";
import { errorMessage, NetworkError, NotFoundError, RateLimitedError } from "../errors.js";
import type { AgentFormat, AgentOptions, AgentResult } from "../op-types.js";

export const AGENT_ORIGIN = "https://scrolller.com";

function acceptOf(format: AgentFormat): string {
  return format === "ld+json" ? "application/ld+json" : "application/json";
}

function agentUrl(kind: "subreddit" | "content" | "collection", ref: string | number, options: AgentOptions): string {
  const params: string[] = [];
  if (options.format !== undefined && options.format !== "json") params.push(`format=${encodeURIComponent(options.format)}`);
  // ?limit= is honored by the subreddit/collection routes (RESEARCH.md §4b).
  if (kind !== "content" && options.limit != null) params.push(`limit=${Math.trunc(options.limit)}`);
  const query = params.length > 0 ? `?${params.join("&")}` : "";
  return `${AGENT_ORIGIN}/agent/${kind}/${encodeURIComponent(String(ref))}${query}`;
}

async function agentGet(client: ScrolllerClient, url: string, accept: string): Promise<AgentResult> {
  const headers: Record<string, string> = { Accept: accept };
  const userAgent = client.config.userAgent;
  if (userAgent) headers["User-Agent"] = userAgent;
  for (const [key, value] of Object.entries(client.config.extraHeaders)) {
    headers[key] = String(value);
  }

  let response: UndiciResponse;
  try {
    response = await undiciFetch(url, {
      method: "GET",
      headers,
      dispatcher: client.dispatcher,
      signal: AbortSignal.timeout(client.config.timeoutMs),
    });
  } catch (error) {
    throw new NetworkError(`agent request failed for ${url}: ${errorMessage(error)}`);
  }
  if (response.status === 404) {
    throw new NotFoundError(`agent route not found (HTTP 404): ${url}`);
  }
  if (response.status === 429) {
    throw new RateLimitedError(`agent route rate limited (HTTP 429): ${url} — keep to ~1 request/second`);
  }
  if (!response.ok) {
    throw new NetworkError(`HTTP ${response.status} from agent route ${url}`, { httpStatus: response.status });
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new NetworkError(`agent route returned invalid JSON (${url}): ${errorMessage(error)}`);
  }
  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    return body as AgentResult;
  }
  throw new NetworkError(`agent route returned an unexpected body shape (${url})`);
}

async function agentSubreddit(this: ScrolllerClient, slug: string, options: AgentOptions = {}): Promise<AgentResult> {
  return agentGet(this, agentUrl("subreddit", slug, options), acceptOf(options.format ?? "json"));
}

async function agentContent(this: ScrolllerClient, slug: string, options: AgentOptions = {}): Promise<AgentResult> {
  return agentGet(this, agentUrl("content", slug, options), acceptOf(options.format ?? "json"));
}

async function agentCollection(this: ScrolllerClient, id: number | string, options: AgentOptions = {}): Promise<AgentResult> {
  return agentGet(this, agentUrl("collection", id, options), acceptOf(options.format ?? "json"));
}

ScrolllerClient.prototype.agentSubreddit = agentSubreddit;
ScrolllerClient.prototype.agentContent = agentContent;
ScrolllerClient.prototype.agentCollection = agentCollection;

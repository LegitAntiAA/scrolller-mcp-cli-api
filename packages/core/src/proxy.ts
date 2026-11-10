/** Proxy plumbing (CONTRACT.md §4): ProxyConfig parsing + undici Dispatcher construction.
 *
 * http/https use undici `ProxyAgent`; socks4/socks5 use the `socks` package as a
 * custom undici connect function (`Agent({ connect })`). All failures map to
 * `ProxyError`.
 */
import { Agent, buildConnector, ProxyAgent } from "undici";
import type { Dispatcher } from "undici";
import { SocksClient } from "socks";
import { errorMessage, ProxyError } from "./errors.js";
import { DEFAULT_TIMEOUT_MS, PROXY_TYPES, type ProxyConfig, type ProxyType } from "./types.js";

export const SUPPORTED_PROXY_TYPES: readonly ProxyType[] = PROXY_TYPES;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Parse `type://[user:pass@]host:port` (SCROLLLER_PROXY env form, CONTRACT.md §3). */
export function parseProxyUrl(url: string): ProxyConfig {
  if (typeof url !== "string" || !url.trim()) {
    throw new ProxyError("proxy URL must be a non-empty string");
  }
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch (error) {
    throw new ProxyError(`invalid proxy URL ${JSON.stringify(url)}: ${errorMessage(error)}`);
  }
  const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
  if (!(PROXY_TYPES as readonly string[]).includes(scheme)) {
    throw new ProxyError(
      `unsupported proxy type ${JSON.stringify(scheme)}; expected one of: ${PROXY_TYPES.join(", ")}`,
    );
  }
  if (!parsed.hostname) {
    throw new ProxyError(`proxy URL ${JSON.stringify(url)} is missing host`);
  }
  if (!parsed.port) {
    throw new ProxyError(`proxy URL ${JSON.stringify(url)} is missing port`);
  }
  return {
    type: scheme as ProxyType,
    host: parsed.hostname,
    port: Number(parsed.port),
    username: parsed.username ? safeDecode(parsed.username) : null,
    password: parsed.password ? safeDecode(parsed.password) : null,
  };
}

/** JSON-serializable form used by the config file (CONTRACT.md §3). */
export function proxyConfigToDict(config: ProxyConfig): {
  type: ProxyType;
  host: string;
  port: number;
  username: string | null;
  password: string | null;
} {
  return {
    type: config.type,
    host: config.host,
    port: config.port,
    username: config.username ?? null,
    password: config.password ?? null,
  };
}

/** Coerce null / ProxyConfig / config-file dict / URL string into a ProxyConfig. null stays null (no proxy). */
export function asProxyConfig(value: unknown): ProxyConfig | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return parseProxyUrl(value);
  if (typeof value === "object" && !Array.isArray(value)) {
    const raw = value as Record<string, unknown>;
    const type = typeof raw.type === "string" ? raw.type.trim().toLowerCase() : raw.type;
    if (typeof type !== "string" || !(PROXY_TYPES as readonly string[]).includes(type)) {
      throw new ProxyError(
        `proxy type must be one of http, https, socks4, socks5 (got ${JSON.stringify(raw.type)})`,
      );
    }
    if (typeof raw.host !== "string" || !raw.host) {
      throw new ProxyError(`invalid proxy configuration: missing host`);
    }
    const port = Number(raw.port);
    if (!Number.isInteger(port) || port <= 0) {
      throw new ProxyError(`invalid proxy configuration: invalid port ${JSON.stringify(raw.port)}`);
    }
    return {
      type: type as ProxyType,
      host: raw.host,
      port,
      username: raw.username == null ? null : String(raw.username),
      password: raw.password == null ? null : String(raw.password),
    };
  }
  throw new ProxyError(`cannot interpret ${typeof value} as proxy configuration`);
}

/** URI for undici ProxyAgent; undici parses embedded credentials into the Proxy-Authorization header. */
function proxyUri(config: ProxyConfig): string {
  let auth = "";
  if (config.username) {
    auth = encodeURIComponent(config.username);
    if (config.password) auth += `:${encodeURIComponent(config.password)}`;
    auth += "@";
  }
  return `${config.type}://${auth}${config.host}:${config.port}`;
}

/** Custom undici connect function backed by the `socks` package (CONTRACT.md §4).
 *
 * undici calls it for every new connection: SOCKS-connect to the destination,
 * then hand a raw socket back for http, or let undici's own connector TLS-upgrade
 * it for https (`httpSocket`).
 */
function socksConnect(config: ProxyConfig, timeoutMs: number): buildConnector.connector {
  const tlsConnector = buildConnector({ timeout: timeoutMs });
  return function connect(options, callback) {
    const destinationPort = Number(options.port) || (options.protocol === "https:" ? 443 : 80);
    SocksClient.createConnection({
      proxy: {
        host: config.host,
        port: config.port,
        type: config.type === "socks4" ? 4 : 5,
        userId: config.username ?? undefined,
        password: config.password ?? undefined,
      },
      command: "connect",
      destination: { host: options.host ?? options.hostname, port: destinationPort },
      timeout: timeoutMs,
    })
      .then(({ socket }) => {
        if (options.protocol === "https:") {
          tlsConnector({ ...options, httpSocket: socket }, callback);
        } else {
          callback(null, socket);
        }
      })
      .catch((error: unknown) => {
        callback(new ProxyError(`SOCKS proxy failure: ${errorMessage(error)}`), null);
      });
  };
}

export interface DispatcherOptions {
  /** Idle timeout applied to header and body reads, and to the SOCKS handshake (ms). */
  timeoutMs?: number | null;
}

/**
 * Build an undici Dispatcher for a ProxyConfig (CONTRACT.md §4). With null config this is a plain Agent carrying the requested timeouts.
 *
 * HTTP/2 is disabled deliberately (`allowH2: false`): the media hosts negotiate H2, but
 * long-lived H2 sessions (MCP servers) degrade mid-body with undici "terminated" errors
 * (verified live — ClientHttp2Stream.onError → Fetch.terminate). HTTP/1.1 is deterministic.
 */
export function buildDispatcher(config: ProxyConfig | null, options: DispatcherOptions = {}): Dispatcher {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    if (config === null) {
      return new Agent({ allowH2: false, headersTimeout: timeoutMs, bodyTimeout: timeoutMs });
    }
    if (config.type === "http" || config.type === "https") {
      return new ProxyAgent({ uri: proxyUri(config), allowH2: false, headersTimeout: timeoutMs, bodyTimeout: timeoutMs });
    }
    return new Agent({
      allowH2: false,
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      connect: socksConnect(config, timeoutMs),
    });
  } catch (error) {
    throw new ProxyError(`cannot initialize proxy: ${errorMessage(error)}`);
  }
}

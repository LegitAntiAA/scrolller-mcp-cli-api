/** Config file + environment resolution (CONTRACT.md §3).
 *
 * Precedence: explicit argument > environment > config file > defaults.
 * Default config path: `%USERPROFILE%/.config/scrolller/config.json` on Windows,
 * `~/.config/scrolller/config.json` otherwise (XDG respected).
 * Environment variables: SCROLLLER_TOKEN, SCROLLLER_NSFW, SCROLLLER_USER_AGENT,
 * SCROLLLER_EXTRA_HEADERS (JSON), SCROLLLER_PROXY (`type://[user:pass@]host:port`),
 * SCROLLLER_DOWNLOAD_DIR.
 *
 * File IO is synchronous: the client constructor resolves configuration the same
 * way the Python reference does (no async construction).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { errorMessage, ScrolllerError } from "./errors.js";
import { asProxyConfig, parseProxyUrl, proxyConfigToDict } from "./proxy.js";
import {
  DEFAULT_BASE_URL,
  DEFAULT_READ_RETRIES,
  DEFAULT_TIMEOUT_MS,
  NSFW_FILTERS,
  type NsfwFilter,
  type ScrolllerClientInput,
  type ScrolllerClientOptions,
} from "./types.js";

export const CONFIG_DIR_NAME = "scrolller";
export const CONFIG_FILE_NAME = "config.json";

/** Contract §3 defaults as a JSON-shaped dict (snake_case config-file keys). */
export const DEFAULT_CONFIG: Record<string, unknown> = {
  token: null,
  nsfw: "SFW",
  user_agent: null,
  extra_headers: {},
  proxy: null,
  download_dir: "~/Downloads/scrolller",
  timeout_ms: DEFAULT_TIMEOUT_MS,
};

export type EnvLike = Record<string, string | undefined>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Config file location per CONTRACT.md §3 (platform/env injectable for tests). */
export function defaultConfigPath(env: EnvLike = process.env, platform: string = process.platform): string {
  if (platform === "win32") {
    const profile = env.USERPROFILE;
    const base = profile && profile.trim() ? profile : homedir();
    return path.join(base, ".config", CONFIG_DIR_NAME, CONFIG_FILE_NAME);
  }
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && xdg.trim() ? xdg : path.join(homedir(), ".config");
  return path.join(base, CONFIG_DIR_NAME, CONFIG_FILE_NAME);
}

/** Recursively merge `override` onto `base`: plain objects merge, everything else replaces. */
export function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = merged[key];
    if (isPlainObject(value) && isPlainObject(current)) {
      merged[key] = deepMerge(current, value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

/** Read a config JSON file. Missing file -> {}; malformed -> ScrolllerError. */
export function loadConfigFile(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  let data: unknown;
  try {
    const raw = readFileSync(filePath, "utf8");
    data = raw.trim() ? JSON.parse(raw) : {};
    if (!isPlainObject(data)) {
      throw new Error("must contain a JSON object");
    }
  } catch (error) {
    throw new ScrolllerError(`cannot read config file ${filePath}: ${errorMessage(error)}`);
  }
  return data;
}

/** Atomically write config JSON (parent directories created). */
export function saveConfigFile(filePath: string, data: Record<string, unknown>): void {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    renameSync(tmp, filePath);
  } catch (error) {
    throw new ScrolllerError(`cannot write config file ${filePath}: ${errorMessage(error)}`);
  }
}

/** Read-modify-write helper for CLI/MCP: deep-merge `patch` into the config file. */
export function updateConfigFile(filePath: string, patch: Record<string, unknown>): Record<string, unknown> {
  const merged = deepMerge(loadConfigFile(filePath), patch);
  saveConfigFile(filePath, merged);
  return merged;
}

/** Parse the SCROLLLER_EXTRA_HEADERS JSON object. */
export function parseExtraHeaders(raw: string): Record<string, string> {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new ScrolllerError(`SCROLLLER_EXTRA_HEADERS is not valid JSON: ${errorMessage(error)}`);
  }
  if (!isPlainObject(data)) {
    throw new ScrolllerError("SCROLLLER_EXTRA_HEADERS must be a JSON object");
  }
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    headers[key] = String(value);
  }
  return headers;
}

/** Layer SCROLLLER_* environment variables over an already-loaded config. */
export function applyEnvOverrides(config: Record<string, unknown>, env: EnvLike = process.env): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};

  const token = env.SCROLLLER_TOKEN;
  if (token && token.trim()) overrides.token = token;

  const nsfw = env.SCROLLLER_NSFW;
  if (nsfw) {
    const normalized = nsfw.trim().toUpperCase();
    if (!(NSFW_FILTERS as readonly string[]).includes(normalized)) {
      throw new ScrolllerError(`SCROLLLER_NSFW must be one of SFW, NSFW, ALL (got ${JSON.stringify(nsfw)})`);
    }
    overrides.nsfw = normalized;
  }

  const userAgent = env.SCROLLLER_USER_AGENT;
  if (userAgent) overrides.user_agent = userAgent;

  const rawHeaders = env.SCROLLLER_EXTRA_HEADERS;
  if (rawHeaders) overrides.extra_headers = parseExtraHeaders(rawHeaders);

  const rawProxy = env.SCROLLLER_PROXY;
  if (rawProxy) overrides.proxy = proxyConfigToDict(parseProxyUrl(rawProxy));

  const downloadDir = env.SCROLLLER_DOWNLOAD_DIR;
  if (downloadDir) overrides.download_dir = downloadDir;

  return deepMerge(config, overrides);
}

/** defaults <- config file <- environment, as a JSON-shaped dict. */
export function resolveConfig(configPath?: string | null, env: EnvLike = process.env): Record<string, unknown> {
  const filePath = configPath || defaultConfigPath(env);
  return applyEnvOverrides(deepMerge(DEFAULT_CONFIG, loadConfigFile(filePath)), env);
}

function coerceNsfw(value: unknown): NsfwFilter {
  if (value === null || value === undefined) return "SFW";
  const normalized = String(value).toUpperCase();
  if (!(NSFW_FILTERS as readonly string[]).includes(normalized)) {
    throw new ScrolllerError(`invalid nsfw value ${JSON.stringify(value)}; expected SFW, NSFW or ALL`);
  }
  return normalized as NsfwFilter;
}

function coerceHeaders(value: unknown): Record<string, string> {
  if (value === null || value === undefined) return {};
  if (!isPlainObject(value)) {
    throw new ScrolllerError("extra_headers must be an object (mapping of strings)");
  }
  const headers: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    headers[key] = String(entry);
  }
  return headers;
}

function coerceInt(name: string, value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(parsed)) {
    throw new ScrolllerError(`${name} must be an integer, got ${JSON.stringify(value)}`);
  }
  return parsed;
}

function pick(explicit: unknown, key: string, config: Record<string, unknown>): unknown {
  return explicit ?? config[key];
}

/** Resolve effective ScrolllerClientOptions: explicit > env > file > defaults (CONTRACT.md §3). */
export function buildClientOptions(
  input: ScrolllerClientInput = {},
  options: { configPath?: string | null; env?: EnvLike } = {},
): ScrolllerClientOptions {
  const env = options.env ?? process.env;
  const resolvedPath = input.configPath || options.configPath || defaultConfigPath(env);
  const config = resolveConfig(resolvedPath, env);

  return {
    token: (pick(input.token, "token", config) as string | null) || null,
    nsfw: coerceNsfw(pick(input.nsfw, "nsfw", config)),
    userAgent: (pick(input.userAgent, "user_agent", config) as string | null) || null,
    extraHeaders: coerceHeaders(pick(input.extraHeaders, "extra_headers", config)),
    proxy: asProxyConfig(pick(input.proxy, "proxy", config)),
    timeoutMs: coerceInt("timeout_ms", pick(input.timeoutMs, "timeout_ms", config), DEFAULT_TIMEOUT_MS),
    baseUrl: input.baseUrl ?? ((config.base_url as string | undefined) || DEFAULT_BASE_URL),
    downloadDir: (pick(input.downloadDir, "download_dir", config) as string | null) || null,
    readRetries: coerceInt("read_retries", pick(input.readRetries, "read_retries", config), DEFAULT_READ_RETRIES),
    configPath: resolvedPath,
  };
}

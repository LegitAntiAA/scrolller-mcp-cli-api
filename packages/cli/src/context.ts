/** Per-invocation context: global options → ScrolllerClient (CONTRACT.md §2/§3).
 *
 * Flag precedence is handled by core `buildClientOptions`: explicit flag >
 * SCROLLLER_* env > config file > defaults. Only flags actually present are
 * passed (undefined = "not set"), so env/config values still apply otherwise.
 * SCROLLLER_CONFIG_PATH relocates the config file (core `configPath` option).
 */
import {
  GALLERY_FILTERS,
  GALLERY_SORT_BYS,
  NSFW_FILTERS,
  ScrolllerClient,
  ScrolllerError,
  type GalleryFilter,
  type GallerySortBy,
  type NsfwFilter,
} from "scrolller-core";

export interface GlobalOptions {
  json?: boolean;
  verbose?: boolean;
  nsfw?: string;
  userAgent?: string;
  header?: string | string[];
  proxy?: string;
  timeout?: string;
  noBanner?: boolean;
}

export interface Context {
  client: ScrolllerClient;
  json: boolean;
  verbose: boolean;
}

function scrolllerConfigPath(): string | undefined {
  const raw = process.env["SCROLLLER_CONFIG_PATH"];
  return raw && raw.trim() ? raw : undefined;
}

/** Parse repeatable `--header "Name: value"` flags into a header map. */
export function parseExtraHeaders(raw: string | string[] | undefined): Record<string, string> {
  const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const headers: Record<string, string> = {};
  for (const entry of list) {
    const index = entry.indexOf(":");
    if (index <= 0) {
      throw new ScrolllerError(`invalid --header ${JSON.stringify(entry)}; expected "Name: value"`);
    }
    const name = entry.slice(0, index).trim();
    const value = entry.slice(index + 1).trim();
    if (!name || !value) {
      throw new ScrolllerError(`invalid --header ${JSON.stringify(entry)}; expected "Name: value"`);
    }
    headers[name] = value;
  }
  return headers;
}

function coerceNsfwFlag(value: string): NsfwFilter {
  const normalized = value.trim().toUpperCase();
  if (!(NSFW_FILTERS as readonly string[]).includes(normalized)) {
    throw new ScrolllerError(`invalid --nsfw ${JSON.stringify(value)}; expected one of: ${NSFW_FILTERS.join(", ")}`);
  }
  return normalized as NsfwFilter;
}

function coerceTimeout(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ScrolllerError(`invalid --timeout ${JSON.stringify(value)}; expected a positive integer (milliseconds)`);
  }
  return parsed;
}

export function coerceIntOption(value: string, name: string, min = 1): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new ScrolllerError(`invalid --${name} ${JSON.stringify(value)}; expected an integer >= ${min}`);
  }
  return parsed;
}

export function coerceSortBy(value: string | undefined): GallerySortBy | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toUpperCase();
  if (!(GALLERY_SORT_BYS as readonly string[]).includes(normalized)) {
    throw new ScrolllerError(`invalid --sort-by ${JSON.stringify(value)}; expected one of: ${GALLERY_SORT_BYS.join(", ")}`);
  }
  return normalized as GallerySortBy;
}

export function coerceFilter(value: string | undefined): GalleryFilter | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toUpperCase();
  if (!(GALLERY_FILTERS as readonly string[]).includes(normalized)) {
    throw new ScrolllerError(`invalid --filter ${JSON.stringify(value)}; expected one of: ${GALLERY_FILTERS.join(", ")}`);
  }
  return normalized as GalleryFilter;
}

/** Build the one client used by this invocation from the global flags. */
export function buildContext(globals: GlobalOptions): Context {
  const client = new ScrolllerClient({
    nsfw: globals.nsfw !== undefined ? coerceNsfwFlag(globals.nsfw) : undefined,
    userAgent: globals.userAgent,
    extraHeaders: Object.keys(parseExtraHeaders(globals.header)).length > 0 ? parseExtraHeaders(globals.header) : undefined,
    proxy: globals.proxy,
    timeoutMs: globals.timeout !== undefined ? coerceTimeout(globals.timeout) : undefined,
    configPath: scrolllerConfigPath(),
  });
  return { client, json: Boolean(globals.json), verbose: Boolean(globals.verbose) };
}

/** Undo MSYS/Git-Bash path conversion of absolute-looking arguments: under Git
 * Bash, `scrolller post /corvette-...` reaches node as
 * "C:/Program Files/Git/corvette-...". Restores the leading slash so scrolller
 * paths/URLs survive the shell (no-op elsewhere). */
export function normalizeRefArg(value: string): string {
  const msysRoot = "C:/Program Files/Git/";
  if (value.startsWith(msysRoot) && value.length > msysRoot.length) {
    return `/${value.slice(msysRoot.length)}`;
  }
  return value;
}

/** Make a post/subreddit ref absolute: ResolveScrolllerLinks (core resolveLink,
 * used by comments/collections/hide/report id resolution) only accepts full
 * https://scrolller.com/... URLs, while feed post objects carry relative paths
 * like "/corvette-...". No-op for absolute URLs and bare ids. */
export function toAbsoluteScrolllerUrl(value: string): string {
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (value.startsWith("/") && !value.startsWith("//")) return `https://scrolller.com${value}`;
  return value;
}

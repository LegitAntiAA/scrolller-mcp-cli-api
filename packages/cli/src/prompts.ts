/** Interactive prompts (node:readline/promises — zero new dependencies).
 *
 * Password entry is muted by pointing readline's echo at a discarded stream
 * while the prompt itself is written to the real stdout. All helpers refuse to
 * run without a TTY: non-interactive callers get usage guidance instead of a
 * hanging read.
 */
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

function requireTty(command: string, guidance: string): void {
  if (!process.stdin.isTTY) {
    console.error(`${command}: this command is interactive and needs a TTY.`);
    console.error(guidance);
    process.exit(1);
  }
}

export async function promptText(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export async function promptHidden(question: string): Promise<string> {
  process.stdout.write(question);
  const sink = new Writable({ write: (_chunk, _encoding, callback) => callback() });
  const rl = createInterface({ input: process.stdin, output: sink, terminal: true });
  try {
    return (await rl.question("")).trim();
  } finally {
    rl.close();
    process.stdout.write("\n");
  }
}

export async function promptConfirm(question: string, defaultValue = false): Promise<boolean> {
  const hint = defaultValue ? "[Y/n]" : "[y/N]";
  for (;;) {
    const answer = await promptText(`${question} ${hint} `);
    if (answer === "") return defaultValue;
    const normalized = answer.toLowerCase();
    if (normalized === "y" || normalized === "yes") return true;
    if (normalized === "n" || normalized === "no") return false;
    console.log("Please answer y or n.");
  }
}

/** Prompt until one of the allowed answers is given (case-insensitive). */
export async function promptChoice(question: string, allowed: readonly string[], defaultAnswer: string): Promise<string> {
  const hint = allowed.map((a) => (a === defaultAnswer ? a.toUpperCase() : a)).join("/");
  for (;;) {
    const answer = (await promptText(`${question} [${hint}] `)).toLowerCase();
    if (answer === "") return defaultAnswer;
    if (allowed.includes(answer)) return answer;
    console.log(`Please answer one of: ${allowed.join(", ")}`);
  }
}

export const LOGIN_TTY_GUIDANCE = 'Non-interactive login: scrolller login <username> <password>  (or: scrolller token <token>)';

/** Interactive username/password prompts; exits with guidance when not a TTY. */
export async function promptCredentials(): Promise<{ username: string; password: string }> {
  requireTty("login", LOGIN_TTY_GUIDANCE);
  const username = await promptText("Username: ");
  if (!username) {
    console.error("login: username must not be empty");
    process.exit(1);
  }
  const password = await promptHidden("Password (input hidden): ");
  if (!password) {
    console.error("login: password must not be empty");
    process.exit(1);
  }
  return { username, password };
}

export const PROXY_TTY_GUIDANCE =
  'Non-interactive alternatives: scrolller proxy --test / scrolller proxy --clear, or scrolller config set proxy "type://[user:pass@]host:port"';

/** Interactive proxy wizard prompts; exits with guidance when not a TTY. */
export async function promptProxyConfig(): Promise<{ type: string; host: string; port: number; username: string | null; password: string | null }> {
  requireTty("proxy", PROXY_TTY_GUIDANCE);
  const type = await promptChoice("Proxy type", ["http", "https", "socks4", "socks5"], "http");
  const host = await promptText("Host: ");
  if (!host) {
    console.error("proxy: host must not be empty");
    process.exit(1);
  }
  const portRaw = await promptText("Port: ");
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error(`proxy: invalid port ${JSON.stringify(portRaw)}; expected 1-65535`);
    process.exit(1);
  }
  const username = await promptText("Username (blank to skip): ");
  let password: string | null = null;
  if (username) {
    password = await promptHidden("Password (input hidden, blank to skip): ");
    password = password || null;
  }
  return { type, host, port, username: username || null, password };
}

export async function confirmOrExit(question: string, defaultValue = false): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  return promptConfirm(question, defaultValue);
}

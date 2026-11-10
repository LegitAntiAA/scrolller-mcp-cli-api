#!/usr/bin/env node
/**
 * scrolller CLI — banner + donate behavior is a user requirement (BUG-4/BUG-11
 * fixes; do not regress): ANSI gradient banner on interactive start, bare run =
 * banner + help on stdout exit 0, `--no-banner`/`--version` never show it, and
 * (--json) machine output never shows it either. The command tree lives in
 * commands.ts (CONTRACT.md §6 CLI column).
 */
import { Command } from "commander";
import { createRequire } from "node:module";
import { renderBanner } from "./banner.js";
import { registerCommands } from "./commands.js";
import { donateDetails } from "./donate.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const program = new Command();

const collectHeader = (value: string, previous: string[]): string[] => [...previous, value];

program
  .name("scrolller")
  .description("Scrolller toolkit — search, download, like, comment, collect (unofficial)")
  .version(version)
  .option("--json", "machine-readable output (never shows the banner or progress)")
  .option("-v, --verbose", "do not trim media arrays in --json output")
  .option("--nsfw <mode>", "content filter: SFW | NSFW | ALL (default from config)")
  .option("--user-agent <ua>", "override the User-Agent header")
  .option("--header <name:value>", "extra HTTP header (repeatable)", collectHeader, [])
  .option("--proxy <url>", "proxy for this run: type://[user:pass@]host:port")
  .option("--timeout <ms>", "request timeout in milliseconds")
  .option("--no-banner", "hide the ASCII banner")
  .action(() => {
    // Bare invocation: banner (already shown below) + help on stdout, exit 0.
    program.outputHelp();
    process.exit(0);
  });

program
  .command("donate")
  .description("show donation addresses (crypto)")
  .action(() => {
    console.log(donateDetails(process.stdout.isTTY && !process.env["NO_COLOR"]));
  });

registerCommands(program);

// Show the banner when running interactively with no subcommand or with --help.
const argv = process.argv.slice(2);
const isHelpArg = argv.includes("--help") || argv.includes("-h");
const isVersionArg = argv.includes("--version") || argv.includes("-V");
const noBanner = argv.includes("--no-banner") || process.env["SCROLLLER_NO_BANNER"] === "1";
const hasSubcommand = argv.some((a) => !a.startsWith("-"));
// --json is machine output: never a banner (CONTRACT requirement).
const showBanner = !noBanner && !isVersionArg && !argv.includes("--json") && (isHelpArg || !hasSubcommand);

if (showBanner) {
  console.log(renderBanner({ version, donate: !process.argv.includes("--no-banner") }));
  console.log();
}

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

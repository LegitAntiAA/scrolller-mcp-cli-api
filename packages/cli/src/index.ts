#!/usr/bin/env node
/**
 * scrolller CLI — full command tree lands in T5 (Engineer 2).
 * This file already wires the banner + donate command (user-facing requirements).
 */
import { Command } from "commander";
import { createRequire } from "node:module";
import { renderBanner } from "./banner.js";
import { donateDetails } from "./donate.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const program = new Command();

program
  .name("scrolller")
  .description("Scrolller toolkit — search, download, like, comment, collect (unofficial)")
  .version(version)
  .option("--no-banner", "hide the ASCII banner");

program
  .command("donate")
  .description("show donation addresses (crypto)")
  .action(() => {
    console.log(donateDetails(process.stdout.isTTY && !process.env["NO_COLOR"]));
  });

// Show the banner when running interactively with no subcommand or with --help.
const isHelpArg = process.argv.includes("--help") || process.argv.includes("-h");
const hasSubcommand = process.argv.slice(2).some((a) => !a.startsWith("-"));
const showBanner = process.env["SCROLLLER_NO_BANNER"] !== "1" && (isHelpArg || !hasSubcommand);

if (showBanner) {
  console.log(renderBanner({ version, donate: !process.argv.includes("--no-banner") }));
  console.log();
}

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

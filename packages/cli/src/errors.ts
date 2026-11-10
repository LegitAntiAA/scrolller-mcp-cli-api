/** Central command error handling (CONTRACT.md §5 / §5.1).
 *
 * - AuthRequiredError → the §5.1 one-liner → exit 1.
 * - Other ScrolllerErrors → clean one-line message (no stack) → exit 1.
 * - --json → {"error": {"kind", "message"}} on stdout instead.
 * - Unexpected (non-Scrolller) errors keep their stack for debugging.
 */
import { AuthRequiredError, ScrolllerError, errorMessage } from "scrolller-core";

/** Exact auth guidance string for the CLI (CONTRACT.md §5.1). */
export const CLI_AUTH_MESSAGE = 'Not authenticated. Run "scrolller login" or "scrolller token <token>"';

/** Local usage/validation error — same clean handling as ScrolllerError. */
export class UsageError extends Error {}

export interface ErrorContext {
  json: boolean;
}

function printError(context: ErrorContext, kind: string, message: string): void {
  if (context.json) {
    console.log(JSON.stringify({ error: { kind, message } }));
  } else {
    console.error(kind === "USAGE" ? `error: ${message}` : `error [${kind}]: ${message}`);
  }
}

/** Run an action body; map errors per CONTRACT §5.1 and exit 1 on failure. */
export async function runAction(context: ErrorContext, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      printError(context, "AUTH_REQUIRED", context.json ? error.message : CLI_AUTH_MESSAGE);
    } else if (error instanceof UsageError) {
      printError(context, "USAGE", errorMessage(error));
    } else if (error instanceof ScrolllerError) {
      printError(context, error.kind ?? "SCROLLLER_ERROR", errorMessage(error));
    } else {
      const message = errorMessage(error);
      if (context.json) {
        printError(context, "UNKNOWN", message);
      } else {
        console.error(`error: ${message}`);
        if (error instanceof Error && error.stack) console.error(error.stack);
      }
    }
    process.exit(1);
  }
}

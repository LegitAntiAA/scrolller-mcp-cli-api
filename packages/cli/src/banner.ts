/** Colored ASCII startup banner. Pure ANSI, no dependencies. */
import { donateBannerLine } from "./donate.js";

const SCROLLLER_ROWS: string[] = [
  "███████╗ ██████╗██████╗  ██████╗ ██╗     ██╗     ██╗     ███████╗██████╗ ",
  "██╔════╝██╔════╝██╔══██╗██╔═══██╗██║     ██║     ██║     ██╔════╝██╔══██╗",
  "███████╗██║     ██████╔╝██║   ██║██║     ██║     ██║     █████╗  ██████╔╝",
  "╚════██║██║     ██╔══██╗██║   ██║██║     ██║     ██║     ██╔══╝  ██╔══██╗",
  "███████║╚██████╗██║  ██║╚██████╔╝███████╗███████╗███████╗███████╗██║  ██║",
  "╚══════╝ ╚═════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚══════╝╚══════╝╚══════╝╚═╝  ╚═╝",
];

/** Letter widths per row (all rows have 9 letters of fixed block width; we slice by measured columns). */
const LETTER_BOUNDS: Array<[number, number]> = [
  [0, 8],
  [9, 17],
  [18, 25],
  [26, 35],
  [36, 43],
  [44, 51],
  [52, 59],
  [60, 68],
  [69, 77],
];

/** Pink → violet gradient across the 9 letters of "SCROLLLER". */
function gradient(): Array<[number, number, number]> {
  const from = [255, 95, 162] as const;
  const to = [123, 47, 247] as const;
  return LETTER_BOUNDS.map((_, i) => {
    const t = i / (LETTER_BOUNDS.length - 1);
    return [
      Math.round(from[0] + (to[0] - from[0]) * t),
      Math.round(from[1] + (to[1] - from[1]) * t),
      Math.round(from[2] + (to[2] - from[2]) * t),
    ];
  });
}

function rgb(r: number, g: number, b: number, text: string): string {
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

export interface BannerOptions {
  version: string;
  /** Show compact donation links (default true) */
  donate?: boolean;
  useColor?: boolean;
}

export function renderBanner(options: BannerOptions): string {
  const useColor = options.useColor ?? (process.stdout.isTTY && !process.env["NO_COLOR"]);
  const lines: string[] = [];
  const grad = gradient();

  for (const row of SCROLLLER_ROWS) {
    if (!useColor) {
      lines.push("  " + row);
      continue;
    }
    let line = "  ";
    LETTER_BOUNDS.forEach(([start, end], i) => {
      const [r, g, b] = grad[i] ?? [255, 255, 255];
      line += rgb(r, g, b, row.slice(start, end + 1));
    });
    lines.push(line);
  }

  const sub = "  C L I   ·   M C P   ·   A P I";
  const ver = `v${options.version}`;
  lines.push(useColor ? `${rgb(160, 160, 160, sub)}  ${rgb(120, 120, 120, ver)}` : `${sub}  ${ver}`);

  if (options.donate !== false) {
    lines.push(donateBannerLine(useColor));
    lines.push(useColor ? rgb(120, 120, 120, "  full addresses: scrolller donate") : "  full addresses: scrolller donate");
  }
  return lines.join("\n");
}

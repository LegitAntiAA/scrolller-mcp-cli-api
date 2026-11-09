/** Donation addresses and colored formatting. Canonical wallet list (keep in sync with README "Donate"). */

export interface Wallet {
  label: string;
  address: string;
  /** RGB color used for the label/link in the banner and donate output */
  color: [number, number, number];
}

export const WALLETS: Wallet[] = [
  { label: "BTC", address: "bc1qw4my95y7uhmg7up7w762qfju04l6960plpkp0u", color: [247, 147, 26] },
  { label: "Ethereum (ETH)", address: "0x9a3e38ffa8d0002e8423a101b98ef214a574abde", color: [98, 126, 234] },
  { label: "USDT (ERC-20)", address: "0x9a3e38ffa8d0002e8423a101b98ef214a574abde", color: [38, 161, 123] },
  { label: "USDT (TRC-20)", address: "TNGrTqLZZdf99zTQoSABvXmAzPTh7NfESk", color: [38, 161, 123] },
  { label: "TON", address: "UQBwZJojKzuIFCpf4V_RSVCSub4J96IWulnfeJ-hYRviB3nw", color: [0, 152, 234] },
];

export function shortAddress(address: string): string {
  if (address.length <= 16) return address;
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function rgb(r: number, g: number, b: number, text: string): string {
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

/** One compact colored line for the startup banner. */
export function donateBannerLine(useColor: boolean): string {
  const parts = WALLETS.map((w) =>
    useColor
      ? rgb(w.color[0], w.color[1], w.color[2], `${w.label} ${shortAddress(w.address)}`)
      : `${w.label} ${shortAddress(w.address)}`,
  );
  const heart = useColor ? rgb(255, 95, 162, "💖") : "";
  const prefix = useColor ? rgb(200, 200, 200, "  donate:") : "  donate:";
  return `${heart}${prefix} ${parts.join(useColor ? rgb(120, 120, 120, " · ") : " · ")}`;
}

/** Full colored table printed by `scrolller donate`. */
export function donateDetails(useColor: boolean): string {
  const lines: string[] = [];
  const title = useColor ? rgb(255, 95, 162, "💖 Support scrolller-mcp-cli-api") : "Support scrolller-mcp-cli-api";
  lines.push(title, "");
  for (const w of WALLETS) {
    const label = useColor ? rgb(w.color[0], w.color[1], w.color[2], w.label.padEnd(14)) : w.label.padEnd(14);
    lines.push(`  ${label} ${w.address}`);
  }
  lines.push("", useColor ? rgb(160, 160, 160, "Thank you! Every donation speeds up development. 🙏") : "Thank you! Every donation speeds up development. 🙏");
  return lines.join("\n");
}

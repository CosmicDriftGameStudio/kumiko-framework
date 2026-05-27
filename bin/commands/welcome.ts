// Welcome-Block für `kumiko` (no-args TTY fallback) und `kumiko help`.
// Wird auch vom Ink-TUI im TitleBar referenziert.
//
// Returns lines without trailing newlines. Caller joins with "\n".

import type { Role } from "./types";

const TAGLINE = "Config-driven, command-based, realtime multi-tenant app framework.";

const DOCS_LINKS: ReadonlyArray<readonly [string, string]> = [
  ["Quickstart", "https://docs.kumiko.rocks/quickstart/quickstart/"],
  ["Walkthrough", "https://docs.kumiko.rocks/walkthrough/"],
  ["Concepts", "https://docs.kumiko.rocks/concepts/"],
  ["CLI reference", "https://docs.kumiko.rocks/cli/"],
];

const ROLE_HINT: Record<Role, string> = {
  "app-dev": "Run `kumiko <command>` or `kumiko help <command>` for details.",
  maintainer: "Maintainer mode — extra commands available. `kumiko help <command>` for details.",
};

export function getWelcomeBlock(role: Role): ReadonlyArray<string> {
  const linkLines = DOCS_LINKS.map(([label, url], i) => {
    const prefix = i === 0 ? "  Docs: " : "        ";
    return `${prefix}${label.padEnd(15)} ${url}`;
  });
  return [
    `  kumiko — ${TAGLINE}`,
    "",
    ...linkLines,
    "",
    `  ${ROLE_HINT[role]}`,
  ];
}

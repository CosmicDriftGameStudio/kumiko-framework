// Welcome-Block für `kumiko` (no-args TTY fallback) und `kumiko help`.
// Wird auch vom Ink-TUI im TitleBar referenziert.
//
// Returns lines without trailing newlines. Caller joins with "\n".

import { WELCOME_DOC_LINKS, cliCommandDocUrl } from "../docs-urls";
import type { Command, Role } from "./types";

const TAGLINE = "Config-driven, command-based, realtime multi-tenant app framework.";

const ROLE_HINT: Record<Role, string> = {
  "app-dev": "Run `kumiko <command>` or `kumiko help <command>` for details.",
  maintainer: "Maintainer mode — extra commands available. `kumiko help <command>` for details.",
};

export function getWelcomeBlock(role: Role): ReadonlyArray<string> {
  const linkLines = WELCOME_DOC_LINKS.map(([label, url], i) => {
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

export function printCommandHelp(cmd: Command, sink: Pick<Console, "log"> = console): void {
  sink.log("");
  sink.log(`  kumiko ${cmd.id} — ${cmd.description}`);
  sink.log("");
  for (const line of cmd.help.split("\n")) {
    sink.log(`  ${line}`);
  }
  sink.log("");
  sink.log(`  Docs: ${cliCommandDocUrl(cmd.id)}`);
  sink.log("");
}

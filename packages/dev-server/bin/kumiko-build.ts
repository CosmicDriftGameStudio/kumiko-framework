#!/usr/bin/env bun
// kumiko-build — Production-Build für Kumiko-Apps. Convention-driven:
//
//   src/client.tsx | src/styles.css | public/   →  Client-Bundle (dist/)
//   bin/main.ts                                  →  Server-Bundle (dist-server/)
//
// Beide werden gebaut wenn die jeweiligen Conventions getroffen sind, sonst
// übersprungen. Ein Workspace mit nur bin/main.ts kriegt nur den Server-
// Bundle, ein Browser-only-Sample nur den Client.
//
//   {
//     "scripts": { "build": "kumiko-build" }
//   }
//
// Optionaler Pfad-Parameter überschreibt cwd:
//   kumiko-build samples/apps/showcase

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  buildProdBundle,
  buildServerBundle,
  discoverClientEntry,
  discoverServerEntry,
  formatBuildResult,
  formatServerBuildResult,
} from "../src/build";

const explicit = process.argv[2];
const cwd = explicit ? resolve(process.cwd(), explicit) : process.cwd();

const red = "\x1b[31m";
const yellow = "\x1b[33m";
const reset = "\x1b[0m";

const hasClient =
  discoverClientEntry(cwd) !== undefined ||
  existsSync(join(cwd, "src/styles.css")) ||
  existsSync(join(cwd, "public")) ||
  existsSync(join(cwd, "index.html"));
const hasServer = discoverServerEntry(cwd) !== undefined;

if (!hasClient && !hasServer) {
  // biome-ignore lint/suspicious/noConsole: CLI-Output, einziger Weg
  console.error(
    `\n  ${yellow}!${reset} Nichts zu bauen in ${cwd}.\n` +
      `    Convention: src/client.tsx oder bin/main.ts erwartet.\n`,
  );
  process.exit(1);
}

try {
  if (hasClient) {
    const t0 = performance.now();
    const result = await buildProdBundle({ cwd });
    const ms = Math.round(performance.now() - t0);
    // biome-ignore lint/suspicious/noConsole: CLI-Output, einziger Weg
    console.log(formatBuildResult(result, ms));
  }
  if (hasServer) {
    const t0 = performance.now();
    const result = await buildServerBundle({ cwd });
    const ms = Math.round(performance.now() - t0);
    // biome-ignore lint/suspicious/noConsole: CLI-Output, einziger Weg
    console.log(formatServerBuildResult(result, ms));
  }
} catch (err) {
  // biome-ignore lint/suspicious/noConsole: CLI-Output, einziger Weg
  console.error(`\n  ${red}✗${reset} ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}

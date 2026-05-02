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
  discoverClientEntries,
  discoverServerEntry,
  formatBuildResult,
  formatServerBuildResult,
} from "../src/build";
import { runCodegen } from "../src/codegen";

const explicit = process.argv[2];
const cwd = explicit ? resolve(process.cwd(), explicit) : process.cwd();

const red = "\x1b[31m";
const yellow = "\x1b[33m";
const reset = "\x1b[0m";

const hasClient =
  discoverClientEntries(cwd).length > 0 ||
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
  // Codegen-Pass vor dem Build — sicherstellt dass `.kumiko/define.ts`
  // und `types.generated.d.ts` synchron mit den r.defineEvent-Aufrufen
  // sind. Ohne diesen Pass würde ein veraltetes Wrapper-File ein
  // Build-Error oder schlimmer: einen Build mit stale Augmentation
  // erzeugen, der zur Laufzeit die falschen Events erlaubt.
  const cgResult = runCodegen({ appRoot: cwd });
  if (cgResult.warnings.length > 0) {
    for (const w of cgResult.warnings) {
      // biome-ignore lint/suspicious/noConsole: CLI-Output
      console.warn(`${yellow}!${reset} [codegen] ${w.file}:${w.line} — ${w.reason}`);
    }
  }

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

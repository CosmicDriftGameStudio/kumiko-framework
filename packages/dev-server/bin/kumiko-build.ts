#!/usr/bin/env bun
// kumiko-build — CLI-Wrapper um buildProdBundle. Wird als `bin` aus
// dem package.json gehoisted, sodass `yarn build` in jedem Workspace
// funktioniert ohne hardcodierte Repo-Root-Pfade.
//
//   {
//     "scripts": { "build": "kumiko-build" }
//   }
//
// Optionaler Pfad-Parameter überschreibt cwd:
//   kumiko-build samples/apps/showcase

import { resolve } from "node:path";
import { buildProdBundle, formatBuildResult } from "../src/build-prod-bundle";

const explicit = process.argv[2];
const cwd = explicit ? resolve(process.cwd(), explicit) : process.cwd();

const t0 = performance.now();
try {
  const result = await buildProdBundle({ cwd });
  const ms = Math.round(performance.now() - t0);
  // biome-ignore lint/suspicious/noConsole: CLI-Output, einziger Weg
  console.log(formatBuildResult(result, ms));
} catch (err) {
  const red = "\x1b[31m";
  const reset = "\x1b[0m";
  // biome-ignore lint/suspicious/noConsole: CLI-Output, einziger Weg
  console.error(`\n  ${red}✗${reset} ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}

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
import { buildProdBundle } from "../src/build-prod-bundle";

const explicit = process.argv[2];
const cwd = explicit ? resolve(process.cwd(), explicit) : process.cwd();

const t0 = performance.now();
try {
  const result = await buildProdBundle({ cwd });
  const ms = Math.round(performance.now() - t0);
  const dim = "\x1b[2m";
  const green = "\x1b[32m";
  const reset = "\x1b[0m";
  // biome-ignore lint/suspicious/noConsole: CLI-Output, einziger Weg
  console.log(`\n  ${green}✓${reset} built ${cwd} → ${result.outDir} ${dim}(${ms}ms)${reset}`);
  for (const [logical, hashed] of Object.entries(result.manifest)) {
    // biome-ignore lint/suspicious/noConsole: CLI-Output, einziger Weg
    console.log(`    ${dim}${logical.padEnd(14)}${reset} ${hashed}`);
  }
  // biome-ignore lint/suspicious/noConsole: CLI-Output, einziger Weg
  console.log();
} catch (err) {
  const red = "\x1b[31m";
  const reset = "\x1b[0m";
  // biome-ignore lint/suspicious/noConsole: CLI-Output, einziger Weg
  console.error(`\n  ${red}✗${reset} ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}

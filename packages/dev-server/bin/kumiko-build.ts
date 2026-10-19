#!/usr/bin/env bun
// kumiko-build — production build for Kumiko apps. Convention-driven:
//
//   package.json "kumiko.clientEntries"/"kumiko.clientEntry",
//     or src/client.tsx | src/styles.css | public/   →  client bundle (dist/)
//   bin/main.ts                                       →  server bundle (dist-server/,
//                                                        incl. bun.lock seeded from the app's bun.lock)
//
// Both are built when their conventions match, otherwise skipped. A workspace
// with only bin/main.ts gets just the server bundle, a browser-only sample
// just the client.
//
//   {
//     "scripts": { "build": "kumiko-build" }
//   }
//
// An optional path argument overrides cwd:
//   kumiko-build samples/apps/showcase
//
// Extra server entry points (repeatable, paths relative to the app dir), each
// emitted as dist-server/<basename>.js:
//   kumiko-build --entry bin/remote-probe.ts

import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  buildProdBundle,
  buildServerBundle,
  discoverServerEntry,
  formatBuildResult,
  formatServerBuildResult,
  parseKumikoBuildArgs,
  readClientEntriesConfig,
  readExtraRuntimeExternals,
  resolveClientEntries,
  writeServerLockfile,
} from "@cosmicdrift/kumiko-dev-server/cli";

if (process.argv.slice(2).some((arg) => arg === "--help" || arg === "-h")) {
  process.stdout.write(
    "Usage: kumiko-build [app-dir] [--entry <path>]...   build client (dist/) and server (dist-server/) bundles; --entry adds a server entry point (dist-server/<basename>.js)\n",
  );
  process.exit(0);
}

const red = "\x1b[31m";
const yellow = "\x1b[33m";
const dim = "\x1b[2m";
const reset = "\x1b[0m";

try {
  const buildArgs = parseKumikoBuildArgs(process.argv.slice(2));
  const cwd = buildArgs.appDir ? resolve(process.cwd(), buildArgs.appDir) : process.cwd();

  // Read once up front — resolveClientEntries can throw (mutual exclusion,
  // malformed declaration, unmigrated legacy client-*.tsx files) and that
  // must surface through the same ✗/exit(1) path as every other build error.
  const declaredClientEntries = readClientEntriesConfig(cwd);
  const hasClient =
    resolveClientEntries(cwd, declaredClientEntries).length > 0 ||
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

  if (hasClient) {
    const t0 = performance.now();
    const result = await buildProdBundle({ cwd, ...declaredClientEntries });
    const ms = Math.round(performance.now() - t0);
    // biome-ignore lint/suspicious/noConsole: CLI-Output, einziger Weg
    console.log(formatBuildResult(result, ms));
  }
  if (hasServer) {
    const t0 = performance.now();
    const extraRuntimeExternals = readExtraRuntimeExternals(cwd);
    const result = await buildServerBundle({
      cwd,
      ...(extraRuntimeExternals.length > 0 && { extraRuntimeExternals }),
      ...(buildArgs.extraEntries.length > 0 && { extraEntries: buildArgs.extraEntries }),
    });
    const ms = Math.round(performance.now() - t0);
    const lock = await writeServerLockfile({ cwd, outDir: result.outDir });
    const lockLine =
      lock.mode === "seeded"
        ? `    ${dim}bun.lock seeded from ${relative(cwd, lock.seedLockfile) || "bun.lock"}${reset}`
        : `    ${yellow}!${reset} bun.lock resolved fresh – no bun.lock found above ${cwd}`;
    // biome-ignore lint/suspicious/noConsole: CLI-Output, einziger Weg
    console.log(`${formatServerBuildResult(result, ms)}\n${lockLine}`);
  }
} catch (err) {
  // biome-ignore lint/suspicious/noConsole: CLI-Output, einziger Weg
  console.error(`\n  ${red}✗${reset} ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}

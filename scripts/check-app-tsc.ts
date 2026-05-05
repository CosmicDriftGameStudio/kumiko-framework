#!/usr/bin/env bun
// @runtime tooling
// check-app-tsc — runs `tsc --noEmit` per sample workspace.
//
// WHY this exists:
//
// The root `tsconfig.json#references` only points at framework packages
// (`packages/*`) and `app/`. Sample apps under `samples/` have their own
// per-app `tsconfig.json` files but aren't in the references chain — so
// `yarn tsc -b` from the root never traverses into them. The IDE checks
// them individually (the language server picks the closest tsconfig per
// file), so developers see errors that `kumiko check` had reported as
// PASS. This script closes that gap.
//
// AUTO-DISCOVERY:
//
// Every directory under `samples/<category>/<app>/` with a `tsconfig.json`
// is included automatically. A dev creating a new sample app under
// `samples/...` gets the check coverage for free — no manual list to
// update, no documentation to remember.
//
// EXIT BEHAVIOUR:
//
// Exits non-zero if any sample workspace produces tsc diagnostics.
// Errors are printed per-workspace, plus a summary line with totals.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { runCodegen } from "@cosmicdrift/kumiko-dev-server";

const REPO_ROOT = resolve(import.meta.dir, "..");

function findSampleTsconfigs(): string[] {
  const samplesDir = join(REPO_ROOT, "samples");
  if (!existsSync(samplesDir)) return [];

  const out: string[] = [];
  // Two-level walk: samples/<category>/<app>/tsconfig.json
  for (const category of readdirSync(samplesDir)) {
    const catPath = join(samplesDir, category);
    if (!statSync(catPath).isDirectory()) continue;
    for (const app of readdirSync(catPath)) {
      const appPath = join(catPath, app);
      if (!statSync(appPath).isDirectory()) continue;
      const tsconfig = join(appPath, "tsconfig.json");
      if (existsSync(tsconfig)) out.push(appPath);
    }
  }
  return out.sort();
}

type AppResult = {
  readonly name: string;
  readonly ok: boolean;
  readonly errorCount: number;
  readonly output: string;
};

function checkApp(appRoot: string): AppResult {
  const name = relative(REPO_ROOT, appRoot);
  // Codegen vor tsc: apps die `r.defineEvent` nutzen brauchen
  // `.kumiko/define.ts` + `.kumiko/types.generated.d.ts` damit
  // `@app/define`-Imports resolven und event-name-templates typed
  // sind. Lokal generiert der dev-server das, in CI ist alles frisch
  // — also hier explizit triggern. Idempotent: schreibt nur bei
  // Änderung, no-op wenn synchron.
  runCodegen({ appRoot });
  // tsc lives in the root node_modules/.bin (single hoisted install).
  // yarn 4 doesn't auto-fallback to root .bin from a workspace, so we
  // invoke the binary directly with the workspace as cwd — that gives
  // tsc the workspace's tsconfig as the project root.
  const tscBin = join(REPO_ROOT, "node_modules", ".bin", "tsc");
  const result = spawnSync(tscBin, ["--noEmit"], {
    cwd: appRoot,
    encoding: "utf8",
  });
  const combined = (result.stdout ?? "") + (result.stderr ?? "");
  const errorLines = combined.split("\n").filter((l) => / error TS\d+:/.test(l));
  return {
    name,
    ok: result.status === 0,
    errorCount: errorLines.length,
    output: errorLines.join("\n"),
  };
}

const apps = findSampleTsconfigs();
if (apps.length === 0) {
  console.log("check-app-tsc: no sample tsconfigs found — nothing to check.");
  process.exit(0);
}

console.log(`check-app-tsc: type-checking ${apps.length} sample app(s)`);

let totalErrors = 0;
const failedApps: { name: string; errorCount: number }[] = [];
for (const app of apps) {
  const r = checkApp(app);
  if (!r.ok) {
    totalErrors += r.errorCount;
    failedApps.push({ name: r.name, errorCount: r.errorCount });
    console.log(`\n--- ${r.name} (${r.errorCount} errors) ---`);
    console.log(r.output);
  } else {
    console.log(`  ✓ ${r.name}`);
  }
}

if (failedApps.length > 0) {
  console.log(`\n${totalErrors} errors across ${failedApps.length} app(s):`);
  for (const a of failedApps) console.log(`  - ${a.name}: ${a.errorCount}`);
  process.exit(1);
}

console.log(`\nAll ${apps.length} sample app(s) compile cleanly.`);

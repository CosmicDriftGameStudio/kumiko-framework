#!/usr/bin/env bun
// @runtime tooling
// codegen-samples — runs runCodegen() for every sample app under
// `samples/<category>/<app>/`. Wired as root postinstall so that
// `.kumiko/` (the @app/define package) exists right after a fresh
// `yarn install`. Without this, tsc and vitest can't resolve
// `@app/define` until the dev-server has run once.
//
// Auto-discovery mirrors check-app-tsc.ts: any directory with a
// `tsconfig.json` two levels deep under `samples/` is included.
// Idempotent — runCodegen writes only on diff, so repeat invocations
// are cheap.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

async function main() {
  // Dynamic import — during `bun install`, workspace packages may not be
  // linked yet (install order differs from yarn). Skip silently.
  let runCodegen: typeof import("@cosmicdrift/kumiko-dev-server").runCodegen;
  try {
    ({ runCodegen } = await import("@cosmicdrift/kumiko-dev-server"));
  } catch {
    console.log("[codegen-samples] kumiko-dev-server not yet available — skip.");
    process.exit(0);
  }

const REPO_ROOT = resolve(import.meta.dir, "..");

function findSampleApps(): string[] {
  const samplesDir = join(REPO_ROOT, "samples");
  if (!existsSync(samplesDir)) return [];

  // Discovery: alle apps mit `package.json` + `src/`. Bewusst ohne
  // tsconfig-Filter — apps wie `cross-feature-events` haben kein
  // eigenes tsconfig (sie laufen via root-Project), brauchen aber
  // trotzdem `.kumiko/` weil sie `@app/define` importieren. runCodegen
  // bailed lautlos wenn keine `r.defineEvent`-Calls existieren, also
  // ist die breite Discovery billig.
  const out: string[] = [];
  for (const category of readdirSync(samplesDir)) {
    const catPath = join(samplesDir, category);
    if (!statSync(catPath).isDirectory()) continue;
    for (const app of readdirSync(catPath)) {
      const appPath = join(catPath, app);
      if (!statSync(appPath).isDirectory()) continue;
      if (!existsSync(join(appPath, "package.json"))) continue;
      if (!existsSync(join(appPath, "src"))) continue;
      out.push(appPath);
    }
  }
  return out.sort();
}

const apps = findSampleApps();
  if (apps.length === 0) {
    console.log("[codegen-samples] no sample apps — nothing to do.");
    return;
  }

  const t0 = performance.now();
  let totalEvents = 0;
  let touchedApps = 0;
  for (const appRoot of apps) {
    const result = runCodegen({ appRoot });
    if (result.skipped) continue;
    totalEvents += result.eventCount;
    if (result.didWriteTypes || result.didWriteSchemas || result.didWriteDefine) {
      touchedApps += 1;
      console.log(`  ✓ ${relative(REPO_ROOT, appRoot)} — ${result.eventCount} events`);
    }
  }
  const ms = Math.round(performance.now() - t0);
  console.log(
    `[codegen-samples] ${apps.length} app(s) scanned, ${touchedApps} touched, ${totalEvents} events total, ${ms}ms`,
  );
}

main();

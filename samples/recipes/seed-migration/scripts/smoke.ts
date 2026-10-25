// biome-ignore-all lint/suspicious/noConsole: CLI tool output
//
// Local smoke test for seed migrations.
//
// What it checks (offline, without a pod deploy):
//   1. All seed files in ./seeds/ can be loaded via dynamic import
//      → catches syntax errors + missing default exports + wrong paths
//   2. Every handler QN the seeds reference is registered in the real
//      app registry → catches camelCase typos + drift
//      (bug class 3 from the phase 1 retro)
//   3. Every system user (with or without tenantIdOverride) has access to
//      the referenced handlers → catches access rule drift
//      (bug class 4 from the phase 1 retro)
//
// Writes NOTHING to the DB. Pure read-only validation.
//
// Usage:
//   bun scripts/smoke.ts                  (against ./seeds/)
//   bun scripts/smoke.ts --seeds-dir foo  (custom path)
//
// In CI: run before the `build` step — catches 80% of the phase 1 bugs
// locally in <5 seconds instead of after an 8-minute Docker build in the pod boot.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
// App-specific: take the EFFECTIVE features your app uses
// at runtime. In the typical setup with `runProdApp({ features, auth })`:
//
//   import { composeFeatures } from "@cosmicdrift/kumiko-dev-server";
//   import { APP_FEATURES } from "../src/run-config";
//   const composed = composeFeatures(APP_FEATURES, { includeBundled: true, ... });
//   const features = composed.features;
//
// For a pure app-feature setup (no auth mode) a direct
// import of the app features is enough. Here in the recipe the minimal set for the
// referenced recipe seeds (tenant + config) — the app author swaps it
// for their own feature set.
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { createTenantFeature } from "@cosmicdrift/kumiko-bundled-features/tenant";
import {
  createRegistry,
  createSystemUser,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";

const features = [createConfigFeature(), createTenantFeature()];

const seedsDir = (() => {
  const idx = process.argv.indexOf("--seeds-dir");
  return idx >= 0 ? resolve(process.argv[idx + 1] ?? "./seeds") : resolve("./seeds");
})();

if (!existsSync(seedsDir)) {
  console.log(`✓ no seeds-dir at ${seedsDir} — nothing to smoke-test`);
  process.exit(0);
}

const seedFiles = readdirSync(seedsDir)
  .filter((n) => n.endsWith(".ts") && !n.startsWith("_") && !n.startsWith("."))
  .sort();

if (seedFiles.length === 0) {
  console.log(`✓ ${seedsDir} is empty — nothing to smoke-test`);
  process.exit(0);
}

const registry = createRegistry(features);

let failed = 0;

for (const file of seedFiles) {
  const filePath = resolve(seedsDir, file);
  console.log(`\nseed: ${file}`);

  // 1. Module-load
  try {
    const mod = await import(filePath);
    if (!mod.default || typeof mod.default.run !== "function") {
      console.error("  ✗ missing valid SeedMigration default-export");
      failed++;
      continue;
    }
    console.log(`  ✓ loads: "${mod.default.description}"`);
  } catch (err) {
    console.error(`  ✗ load fail: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
    continue;
  }

  // 2 + 3. QN-Resolution + Access (regex-based, gleiche Logik wie runner's
  // dry-run-validator). Pattern matched inline-string-QNs:
  const source = readFileSync(filePath, "utf-8");
  const qnPattern = /systemWriteAs\s*\(\s*["']([^"']+)["']/g;
  const qns = new Set<string>();
  for (const m of source.matchAll(qnPattern)) {
    const qn = m[1];
    if (qn) qns.add(qn);
  }

  for (const qn of qns) {
    const handler = registry.getWriteHandler(qn);
    if (!handler) {
      console.error(`  ✗ handler "${qn}" not registered`);
      failed++;
      continue;
    }
    const accessRoles = (handler.access as { roles?: readonly string[] }).roles ?? [];
    const systemUserRoles = createSystemUser(SYSTEM_TENANT_ID).roles;
    const hasAccess = systemUserRoles.some((r) => accessRoles.includes(r));
    if (!hasAccess) {
      console.error(
        `  ✗ system-user roles=${JSON.stringify([...systemUserRoles])} NOT in access.roles=${JSON.stringify([...accessRoles])} for "${qn}"`,
      );
      failed++;
      continue;
    }
    console.log(`  ✓ "${qn}" registered + accessible`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} issue(s) — fix before push.`);
  process.exit(1);
}
console.log(`\n✓ all ${seedFiles.length} seed-file(s) pass smoke.`);

// biome-ignore-all lint/suspicious/noConsole: CLI tool output
//
// Lokaler Smoke-Test für seed-migrations.
//
// Was er prüft (offline, ohne Pod-Deploy):
//   1. Alle seed-files in ./seeds/ können dynamic-import geladen werden
//      → catched syntax-errors + missing default-exports + falsche paths
//   2. Jeder handler-QN den die seeds referenzieren ist in der echten
//      App-Registry registriert → catched camelCase-typos + drift
//      (Bug-Klasse 3 aus Phase 1 retro)
//   3. Jeder system-user (mit oder ohne tenantIdOverride) hat Access auf
//      die referenzierten Handler → catched access-rule-Drift
//      (Bug-Klasse 4 aus Phase 1 retro)
//
// Schreibt NICHTS in die DB. Reine Read-only Validation.
//
// Usage:
//   bun scripts/smoke.ts                  (gegen ./seeds/)
//   bun scripts/smoke.ts --seeds-dir foo  (custom path)
//
// In CI: vor `build`-Step laufen lassen — fängt 80% der Phase-1-Bugs
// lokal in <5 Sekunden statt nach 8-Minuten-Docker-Build im Pod-Boot.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createRegistry,
  createSystemUser,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";

// App-spezifisch: nimm die EFFEKTIVEN Features die deine App zur Runtime
// nutzt. Im typischen Setup mit `runProdApp({ features, auth })`:
//
//   import { composeFeatures } from "@cosmicdrift/kumiko-dev-server";
//   import { APP_FEATURES } from "../src/run-config";
//   const composed = composeFeatures(APP_FEATURES, { includeBundled: true, ... });
//   const features = composed.features;
//
// Bei reiner App-Feature-Setup (kein auth-mode) reicht ein direkter
// Import der App-Features. Hier im Recipe der minimale set für die
// referenzierten Recipe-Seeds (tenant + config) — App-Author tauscht
// gegen sein eigenes Feature-Set.
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { createTenantFeature } from "@cosmicdrift/kumiko-bundled-features/tenant";
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

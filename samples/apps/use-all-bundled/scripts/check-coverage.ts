#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: CLI-Script, console ist Feature.
//
// C1 M5 coverage lint. Diffs bundled-features-Exports gegen den
// FEATURE_IMPORT_REGISTRY in samples/apps/use-all-bundled/drizzle/
// generate.ts. Fängt zwei Drifts:
//
//   1. Ein neuer feature-export ohne Aufnahme in use-all-bundled
//      → unreferenced exports
//   2. Ein removed feature-export der noch im Registry steht
//      → stale registry
//
// Held-back features für M0.1 (subscription-stripe, channel-email, …)
// stehen in EXPECTED_HELD_BACK. Sobald sie mit stub-options gemountet
// werden, müssen sie aus dieser Liste raus.
//
// Usage:
//   bun samples/apps/use-all-bundled/scripts/check-coverage.ts
// Exit 0 wenn alles in Sync, exit 1 wenn Drift.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const FRAMEWORK_ROOT = resolve(ROOT, "..", "..", "..");

// Held-back exports: existieren in bundled-features, sind aber nicht
// als runtime-feature in use-all-bundled mountbar.
//
// Nach M0.1 nur noch utilities + auto-mounted:
// - utilities: kein r.defineFeature (foundation-shared, files-provider-s3
//   sind pure helpers).
// - auto-mounted: kommt via composeFeatures(includeBundled:true) automatisch
//   (auth-email-password) — wäre doppelt-mount wenn explizit gelistet.
const EXPECTED_HELD_BACK = new Set([
  "auth-email-password", // auto-mounted via composeFeatures(authOptions)
  "files-provider-s3", // utility (createS3Provider helpers), kein defineFeature
  "foundation-shared", // utilities (requireDefined/requireNonEmpty), kein feature
]);

// Sub-paths in bundled-features's package.json exports (./tenant/seeding,
// ./auth-email-password/web, …) sind keine Features, nur utilities.
// Wir interessieren uns nur für top-level-paths.
function isFeatureExportPath(path: string): boolean {
  if (!path.startsWith("./")) return false;
  // Top-level only: kein weiterer "/" nach der ersten Segment.
  return path.slice(2).includes("/") === false;
}

function readBundledExports(): Set<string> {
  const pkg = JSON.parse(
    readFileSync(resolve(FRAMEWORK_ROOT, "packages", "bundled-features", "package.json"), "utf-8"),
  ) as { exports: Record<string, string> };
  const out = new Set<string>();
  for (const key of Object.keys(pkg.exports)) {
    if (isFeatureExportPath(key)) {
      out.add(key.slice(2));
    }
  }
  return out;
}

function readRegistryFeatures(): Set<string> {
  const generateSrc = readFileSync(resolve(ROOT, "drizzle", "generate.ts"), "utf-8");
  // Match object-keys mit Discriminator `kind: "factory" | "named"`.
  // Property-Keys können quoted ("billing-foundation") oder unquoted
  // (config, user) sein — beides ist gültig wenn kebab-segment-free.
  const re = /(?:"([a-z][a-z0-9-]*)"|([a-z][a-z0-9]*)):\s*\{\s*kind:\s*"(factory|named)"/g;
  const out = new Set<string>();
  for (const m of generateSrc.matchAll(re)) {
    const name = m[1] ?? m[2];
    if (name) out.add(name);
  }
  return out;
}

const exports = readBundledExports();
const registry = readRegistryFeatures();

const unreferenced: string[] = [];
const stale: string[] = [];

for (const name of exports) {
  if (registry.has(name)) continue;
  if (EXPECTED_HELD_BACK.has(name)) continue;
  unreferenced.push(name);
}

for (const name of registry) {
  if (!exports.has(name)) stale.push(name);
}

let ok = true;

if (unreferenced.length > 0) {
  console.error(
    `\n❌ ${unreferenced.length} bundled-feature export(s) NICHT in use-all-bundled/drizzle/generate.ts:`,
  );
  for (const name of unreferenced.sort()) {
    console.error(`   - ${name}`);
  }
  console.error(
    "\n  Action: in src/run-config.ts + drizzle/generate.ts FEATURE_IMPORT_REGISTRY aufnehmen,",
  );
  console.error(
    "  oder (wenn mount-options noch fehlen) zu EXPECTED_HELD_BACK in dieser Datei hinzufügen.",
  );
  ok = false;
}

if (stale.length > 0) {
  console.error(
    `\n❌ ${stale.length} FEATURE_IMPORT_REGISTRY entry/entries ohne Match in bundled-features exports:`,
  );
  for (const name of stale.sort()) {
    console.error(`   - ${name}`);
  }
  console.error(
    "\n  Action: aus drizzle/generate.ts FEATURE_IMPORT_REGISTRY entfernen, ggf. App-eigenes Feature.",
  );
  ok = false;
}

if (ok) {
  console.log(
    `✓ Coverage: ${registry.size}/${exports.size} bundled-features mounted, ${EXPECTED_HELD_BACK.size} held-back (M0.1).`,
  );
  process.exit(0);
} else {
  process.exit(1);
}

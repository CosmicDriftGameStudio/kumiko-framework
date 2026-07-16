#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: CLI-Script, console ist Feature.
//
// C1 M5 coverage lint. Diffs bundled-features-Exports gegen den
// FEATURE_IMPORT_REGISTRY in samples/apps/use-all-bundled/schema/
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
  "auth-mfa", // this PR ships the feature; the UI-follow-up PR (#266 PR3) mounts it
  "auth-mfa-user-data", // same as above — mounted alongside auth-mfa in PR3
  "files-provider-s3", // utility (createS3Provider helpers), kein defineFeature
  "foundation-shared", // utilities (requireDefined/requireNonEmpty), kein feature
  "page-render", // shared HTML render/cache helpers (legal/managed-pages), kein defineFeature
  "presets", // feature-bundle helpers (dsgvoSelfServiceFeatures), kein defineFeature
]);

// Sub-paths in bundled-features's package.json exports (./tenant/seeding,
// ./auth-email-password/web, …) sind keine Features, nur utilities.
// Wir interessieren uns nur für top-level-paths. Nicht-Feature-Exports
// (Root ".", package.json, Asset-Endungen) sind ausgeschlossen, damit ein
// künftiger ./styles.css o.ä. nicht fälschlich als unreferenced Feature
// einen CI-Fail auslöst.
function isFeatureExportPath(path: string): boolean {
  if (!path.startsWith("./")) return false;
  const segment = path.slice(2);
  if (segment.length === 0) return false;
  // Top-level only: kein weiterer "/" nach dem ersten Segment.
  if (segment.includes("/")) return false;
  // Feature-Export-Pfade sind extension-frei (./audit, ./feature-toggles).
  // Asset-/Manifest-Exports (./package.json, ./styles.css) haben einen "."
  // im Segment → keine Features.
  return segment.includes(".") === false;
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

function extractRegistryBlock(src: string): string {
  // Anchor auf den FEATURE_IMPORT_REGISTRY-Object-Body. Ohne diesen Anchor
  // würde die kind-Regex jedes `<ident>: { kind: "factory"|"named" }` im File
  // matchen (z.B. eine künftige Hilfsvariable) → false positive/negative.
  const startMatch = /FEATURE_IMPORT_REGISTRY[^=]*=\s*\{/.exec(src);
  if (!startMatch) {
    throw new Error("check-coverage: FEATURE_IMPORT_REGISTRY block not found in generate.ts");
  }
  const bodyStart = startMatch.index + startMatch[0].length;
  // Top-level-Close ist das erste `};` am Zeilenanfang nach bodyStart.
  const closeMatch = /\n};/.exec(src.slice(bodyStart));
  if (!closeMatch) {
    throw new Error("check-coverage: FEATURE_IMPORT_REGISTRY closing `};` not found");
  }
  return src.slice(bodyStart, bodyStart + closeMatch.index);
}

function readRegistryFeatures(): Set<string> {
  const generateSrc = readFileSync(resolve(ROOT, "schema", "generate.ts"), "utf-8");
  const registryBlock = extractRegistryBlock(generateSrc);
  // Match object-keys mit Discriminator `kind: "factory" | "named"`.
  // Property-Keys können quoted ("billing-foundation") oder unquoted
  // (config, user) sein — beides ist gültig wenn kebab-segment-free.
  const re = /(?:"([a-z][a-z0-9-]*)"|([a-z][a-z0-9]*)):\s*\{\s*kind:\s*"(factory|named)"/g;
  const out = new Set<string>();
  for (const m of registryBlock.matchAll(re)) {
    const name = m[1] ?? m[2];
    if (name) out.add(name);
  }
  return out;
}

const exports = readBundledExports();
const registry = readRegistryFeatures();

const unreferenced: string[] = [];
const stale: string[] = [];
// Held-back-Einträge, die kein bundled-Export mehr sind → stale Konfig.
// Ohne diese Prüfung hätte der Drift-Guard in seiner eigenen Konfig einen
// Blind-Spot: ein umbenanntes/entferntes Feature bliebe still in der Liste.
const staleHeldBack: string[] = [];

for (const name of exports) {
  if (registry.has(name)) continue;
  if (EXPECTED_HELD_BACK.has(name)) continue;
  unreferenced.push(name);
}

for (const name of registry) {
  if (!exports.has(name)) stale.push(name);
}

for (const name of EXPECTED_HELD_BACK) {
  if (!exports.has(name)) staleHeldBack.push(name);
}

let ok = true;

if (unreferenced.length > 0) {
  console.error(
    `\n❌ ${unreferenced.length} bundled-feature export(s) NICHT in use-all-bundled/schema/generate.ts:`,
  );
  for (const name of unreferenced.sort()) {
    console.error(`   - ${name}`);
  }
  console.error(
    "\n  Action: in src/run-config.ts + schema/generate.ts FEATURE_IMPORT_REGISTRY aufnehmen,",
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
    "\n  Action: aus schema/generate.ts FEATURE_IMPORT_REGISTRY entfernen, ggf. App-eigenes Feature.",
  );
  ok = false;
}

if (staleHeldBack.length > 0) {
  console.error(
    `\n❌ ${staleHeldBack.length} EXPECTED_HELD_BACK entry/entries ohne Match in bundled-features exports:`,
  );
  for (const name of staleHeldBack.sort()) {
    console.error(`   - ${name}`);
  }
  console.error(
    "\n  Action: aus EXPECTED_HELD_BACK in dieser Datei entfernen (Feature wurde umbenannt/entfernt).",
  );
  ok = false;
}

if (ok) {
  // Disjunkte Zahlen: `mountable` = exports ohne held-back; `coveredCount`
  // zählt nur Registry-Einträge, die ein echter mountbarer Export sind
  // (auth-email-password steht im Registry für schema-check-Konsistenz,
  // ist aber held-back — würde sonst die Ratio >1 verfälschen).
  const mountable = exports.size - EXPECTED_HELD_BACK.size;
  let coveredCount = 0;
  for (const name of registry) {
    if (exports.has(name) && !EXPECTED_HELD_BACK.has(name)) coveredCount++;
  }
  console.log(
    `✓ Coverage: ${coveredCount}/${mountable} mountable bundled-features im Registry, ${EXPECTED_HELD_BACK.size} held-back (M0.1).`,
  );
  process.exit(0);
} else {
  process.exit(1);
}

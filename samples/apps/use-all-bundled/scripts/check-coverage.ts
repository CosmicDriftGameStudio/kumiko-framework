#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: CLI-Script, console ist Feature.
//
// Coverage lint. Diffs die Top-Level-Exports von bundled-features gegen die Features, die
// use-all-bundled mountet (FEATURES aus kumiko/schema.ts: APP_FEATURES plus die von
// composeFeatures ergänzten Auth-/Signup-Features). Fängt drei Drifts:
//
//   1. Ein Export, der weder gemountet ist noch in EXPECTED_HELD_BACK steht
//   2. Ein EXPECTED_HELD_BACK-Eintrag, der kein Export mehr ist
//   3. Ein EXPECTED_HELD_BACK-Eintrag, der inzwischen gemountet ist (stale)
//
// Usage:
//   bun samples/apps/use-all-bundled/scripts/check-coverage.ts
// Exit 0 wenn alles in Sync, exit 1 wenn Drift.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FEATURES } from "../kumiko/schema";

const ROOT = resolve(import.meta.dir, "..");
const FRAMEWORK_ROOT = resolve(ROOT, "..", "..", "..");

// Held-back exports: existieren in bundled-features, sind aber nicht
// als runtime-feature in use-all-bundled mountbar.
//
// Nur Utilities ohne defineFeature (foundation-shared ist pure helpers)
// und scaffold-only Features. Gemountete Features gehören nicht hierher.
const EXPECTED_HELD_BACK = new Set([
  "foundation-shared", // utilities (requireDefined/requireNonEmpty), kein feature
  "page-render", // shared HTML render/cache helpers (legal/managed-pages), kein defineFeature
  "presets", // deprecated feature-bundle helpers (dsgvoSelfServiceFeatures, securityBaselineFeatures), kein defineFeature
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

const exports = readBundledExports();
const mounted = new Set<string>(FEATURES.map((feature) => feature.name));

const unreferenced = [...exports].filter(
  (name) => !mounted.has(name) && !EXPECTED_HELD_BACK.has(name),
);
// Ohne diese Prüfungen hätte der Guard in seiner eigenen Konfig einen Blind-Spot: ein
// umbenanntes oder entferntes Feature bliebe still in der Liste, ein gemountetes ebenso.
const staleHeldBack = [...EXPECTED_HELD_BACK].filter((name) => !exports.has(name));
const mountedHeldBack = [...EXPECTED_HELD_BACK].filter((name) => mounted.has(name));

let ok = true;

if (unreferenced.length > 0) {
  console.error(
    `\n❌ ${unreferenced.length} bundled-feature export(s) nicht in use-all-bundled gemountet:`,
  );
  for (const name of unreferenced.sort()) {
    console.error(`   - ${name}`);
  }
  console.error(
    "\n  Action: in src/run-config.ts mounten, oder (wenn mount-options noch fehlen) zu EXPECTED_HELD_BACK in dieser Datei hinzufügen.",
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

if (mountedHeldBack.length > 0) {
  console.error(
    `\n❌ ${mountedHeldBack.length} EXPECTED_HELD_BACK entry/entries sind gemountet (stale):`,
  );
  for (const name of mountedHeldBack.sort()) {
    console.error(`   - ${name}`);
  }
  console.error("\n  Action: aus EXPECTED_HELD_BACK in dieser Datei entfernen.");
  ok = false;
}

if (!ok) process.exit(1);

const mountable = exports.size - EXPECTED_HELD_BACK.size;
const mountedExports = [...exports].filter((name) => mounted.has(name)).length;
console.log(
  `✓ Coverage: ${mountedExports}/${mountable} mountable bundled-features gemountet, ${EXPECTED_HELD_BACK.size} held-back.`,
);

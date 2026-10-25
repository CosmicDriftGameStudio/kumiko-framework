#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: CLI script, console is the feature.
//
// Coverage lint. Diffs the top-level exports of bundled-features against the features that
// use-all-bundled mounts (FEATURES from kumiko/schema.ts: APP_FEATURES plus the auth/signup
// features added by composeFeatures). Catches three drifts:
//
//   1. An export that is neither mounted nor listed in EXPECTED_HELD_BACK
//   2. An EXPECTED_HELD_BACK entry that is no longer an export
//   3. An EXPECTED_HELD_BACK entry that has since been mounted (stale)
//
// Usage:
//   bun samples/apps/use-all-bundled/scripts/check-coverage.ts
// Exit 0 if everything is in sync, exit 1 on drift.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FEATURES } from "../kumiko/schema";

const ROOT = resolve(import.meta.dir, "..");
const FRAMEWORK_ROOT = resolve(ROOT, "..", "..", "..");

// Held-back exports: exist in bundled-features, but cannot be mounted
// as a runtime feature in use-all-bundled.
//
// Only utilities without defineFeature (foundation-shared is pure helpers)
// and scaffold-only features. Mounted features do not belong here.
const EXPECTED_HELD_BACK = new Set([
  "foundation-shared", // utilities (requireDefined/requireNonEmpty), kein feature
  "page-render", // shared HTML render/cache helpers (legal/managed-pages), kein defineFeature
  "presets", // deprecated feature-bundle helpers (securityBaselineFeatures), kein defineFeature
]);

// Sub-paths in bundled-features's package.json exports (./tenant/seeding,
// ./auth-email-password/web, …) are not features, only utilities.
// We only care about top-level paths. Non-feature exports
// (root ".", package.json, asset extensions) are excluded so that a
// future ./styles.css or similar does not wrongly trigger a CI fail as an
// unreferenced feature.
function isFeatureExportPath(path: string): boolean {
  if (!path.startsWith("./")) return false;
  const segment = path.slice(2);
  if (segment.length === 0) return false;
  // Top-level only: no further "/" after the first segment.
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
// Without these checks the guard would have a blind spot in its own config: a
// renamed or removed feature would silently stay in the list, as would a mounted one.
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

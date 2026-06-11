#!/usr/bin/env bun
// @runtime dev
// biome-ignore-all lint/suspicious/noConsole: CLI-Script, console ist Feature.
//
// Generates feature-manifest.json — the runtime-introspected metadata of
// every bundled feature: config keys (type/scope/default/roles), hard +
// optional dependencies, secrets, extension usages, and cross-feature APIs.
// docs.kumiko.rocks renders this as human-readable reference tables (see the
// kumiko-platform docgen `feature-metadata` generator).
//
// Extraktionslogik lebt geteilt in `buildManifestFromRegistry`
// (@cosmicdrift/kumiko-framework/engine) — auch der enterprise-Generator
// nutzt sie; dieses Script liefert nur noch das Feature-Set + den Pfad.
//
// Source set = APP_FEATURES (the canonical bootable list). Regenerate after
// changing any feature's r.config / r.secret / r.requires / r.useExtension;
// feature-manifest.test.ts fails the build if this file is stale.
//
// Usage: bun run scripts/gen-feature-manifest.ts

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { composeFeatures } from "@cosmicdrift/kumiko-dev-server/compose-features";
import {
  buildManifestFromRegistry,
  createRegistry,
  type FeatureManifest,
  serializeManifest,
} from "@cosmicdrift/kumiko-framework/engine";
import { APP_FEATURES } from "../src/run-config";

export type {
  FeatureManifest,
  ManifestConfigKey,
  ManifestExtension,
  ManifestFeature,
  ManifestSecret,
} from "@cosmicdrift/kumiko-framework/engine";
export { serializeManifest };

export function buildFeatureManifest(): FeatureManifest {
  const features = composeFeatures([...APP_FEATURES], { includeBundled: true });
  const registry = createRegistry(features);
  return buildManifestFromRegistry(registry, {
    source: "samples/apps/use-all-bundled APP_FEATURES (composeFeatures includeBundled)",
  });
}

export const MANIFEST_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "feature-manifest.json",
);

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifest = buildFeatureManifest();
  writeFileSync(MANIFEST_PATH, serializeManifest(manifest), "utf-8");
  console.log(`feature-manifest.json: ${manifest.featureCount} features → ${MANIFEST_PATH}`);
}

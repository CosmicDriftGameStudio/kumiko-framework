#!/usr/bin/env bun
// @runtime dev
// biome-ignore-all lint/suspicious/noConsole: CLI script, console output is the feature.
//
// Generates feature-manifest.json — the runtime-introspected metadata of
// every bundled feature: config keys (type/scope/default/roles), hard +
// optional dependencies, secrets, extension usages, and cross-feature APIs.
// docs.kumiko.rocks renders this as human-readable reference tables (see the
// kumiko-platform docgen `feature-metadata` generator).
//
// Extraction logic lives shared in `buildManifestFromRegistry`
// (@cosmicdrift/kumiko-framework/engine) — the enterprise generator uses it
// too; this script only supplies the feature set + the output paths.
//
// Source set = APP_FEATURES (the canonical bootable list). Regenerate after
// changing any feature's r.config / r.secret / r.requires / r.useExtension;
// feature-manifest.test.ts fails the build if this file is stale.
//
// Usage: bun run scripts/gen-feature-manifest.ts

import { existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildManifestFromRegistry,
  createRegistry,
  type FeatureManifest,
  serializeManifest,
} from "@cosmicdrift/kumiko-framework/engine";
import { composeFeatures } from "@cosmicdrift/kumiko-server-runtime/compose-features";
import { APP_FEATURES, AUTH_COMPOSE_OPTIONS } from "../src/run-config";

export type {
  FeatureManifest,
  ManifestConfigKey,
  ManifestExtension,
  ManifestFeature,
  ManifestSecret,
} from "@cosmicdrift/kumiko-framework/engine";
export { serializeManifest };

export function buildFeatureManifest(): FeatureManifest {
  const features = composeFeatures([...APP_FEATURES], {
    includeBundled: true,
    authOptions: AUTH_COMPOSE_OPTIONS,
  });
  const registry = createRegistry(features);
  return buildManifestFromRegistry(registry, {
    source: "samples/apps/use-all-bundled APP_FEATURES (composeFeatures includeBundled + signup)",
  });
}

export const MANIFEST_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "feature-manifest.json",
);

// Shipped to scaffolded apps via create-kumiko-app's package.json `files` list;
// same content, second write target so the copy can never drift (#1774).
export const CREATE_APP_MANIFEST_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
  "packages/create-kumiko-app/feature-manifest.json",
);

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifest = buildFeatureManifest();
  const serialized = serializeManifest(manifest);
  const targets = [MANIFEST_PATH];
  // Monorepo-only target: a standalone copy of this sample (mirror, or a
  // scaffolded app that kept this script) has no packages/create-kumiko-app
  // sibling to write into.
  if (existsSync(dirname(CREATE_APP_MANIFEST_PATH))) {
    targets.push(CREATE_APP_MANIFEST_PATH);
  } else {
    console.log(
      `feature-manifest.json: skipping create-kumiko-app copy — ${dirname(CREATE_APP_MANIFEST_PATH)} does not exist (monorepo-only target).`,
    );
  }
  for (const path of targets) {
    writeFileSync(path, serialized, "utf-8");
    console.log(`feature-manifest.json: ${manifest.featureCount} features → ${path}`);
  }
}

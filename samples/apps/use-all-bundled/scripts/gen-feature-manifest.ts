#!/usr/bin/env bun
// @runtime dev
// biome-ignore-all lint/suspicious/noConsole: CLI-Script, console ist Feature.
//
// Generates feature-manifest.json — the runtime-introspected metadata of
// every bundled feature: config keys (type/scope/default/roles), hard +
// optional dependencies, secrets, extension usages, and cross-feature APIs.
// docs.kumiko.rocks renders this as human-readable reference tables (see the
// kumiko-platform docgen `feature-metadata` generator). The AST parser can't
// read this — bundled features use imperative factory helpers that defeat
// static extraction — so the source of truth is the *booted* registry.
//
// Source set = APP_FEATURES (the canonical bootable list). Regenerate after
// changing any feature's r.config / r.secret / r.requires / r.useExtension;
// gen-feature-manifest.test.ts fails the build if this file is stale.
//
// Usage: bun run scripts/gen-feature-manifest.ts

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { composeFeatures } from "@cosmicdrift/kumiko-dev-server/compose-features";
import { createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import { APP_FEATURES } from "../src/run-config";

export type ManifestConfigKey = {
  readonly key: string;
  readonly qualifiedName: string;
  readonly type: "text" | "number" | "boolean" | "select";
  readonly scope: string;
  readonly default: string | number | boolean | null;
  readonly encrypted: boolean;
  readonly computed: boolean;
  readonly options: readonly string[] | null;
  readonly bounds: { readonly min?: number; readonly max?: number } | null;
  readonly writeRoles: readonly string[];
  readonly readRoles: readonly string[];
};

export type ManifestSecret = {
  readonly qualifiedName: string;
  readonly scope: string;
  readonly label: string | null;
  readonly hint: string | null;
};

export type ManifestExtension = {
  readonly extensionName: string;
  readonly entityName: string;
};

export type ManifestFeature = {
  readonly name: string;
  readonly toggleableDefault: boolean | null;
  readonly requires: readonly string[];
  readonly optionalRequires: readonly string[];
  readonly configReads: readonly string[];
  readonly exposesApis: readonly string[];
  readonly usesApis: readonly string[];
  readonly extensionsUsed: readonly ManifestExtension[];
  readonly configKeys: readonly ManifestConfigKey[];
  readonly secrets: readonly ManifestSecret[];
};

export type FeatureManifest = {
  readonly source: string;
  readonly featureCount: number;
  readonly features: readonly ManifestFeature[];
};

const CONFIG_SEGMENT = ":config:";

export function buildFeatureManifest(): FeatureManifest {
  const features = composeFeatures([...APP_FEATURES], { includeBundled: true });
  const registry = createRegistry(features);

  const allConfigKeys = registry.getAllConfigKeys();
  const allSecretKeys = registry.getAllSecretKeys();

  const manifestFeatures: ManifestFeature[] = [];
  for (const feature of registry.features.values()) {
    const configKeys: ManifestConfigKey[] = [];
    for (const [qualifiedName, def] of allConfigKeys) {
      const prefix = `${feature.name}${CONFIG_SEGMENT}`;
      if (!qualifiedName.startsWith(prefix)) continue;
      configKeys.push({
        key: qualifiedName.slice(prefix.length),
        qualifiedName,
        type: def.type,
        scope: def.scope,
        default: def.default ?? null,
        encrypted: def.encrypted ?? false,
        computed: def.computed !== undefined,
        options: def.options ?? null,
        bounds: def.bounds ?? null,
        writeRoles: def.access.write,
        readRoles: def.access.read,
      });
    }

    const secrets: ManifestSecret[] = [];
    for (const secret of allSecretKeys.values()) {
      if (!secret.qualifiedName.startsWith(`${feature.name}:`)) continue;
      secrets.push({
        qualifiedName: secret.qualifiedName,
        scope: secret.scope,
        label: secret.label["en"] ?? secret.label["de"] ?? null,
        hint: secret.hint?.["en"] ?? secret.hint?.["de"] ?? null,
      });
    }

    manifestFeatures.push({
      name: feature.name,
      toggleableDefault: feature.toggleableDefault ?? null,
      requires: [...feature.requires],
      optionalRequires: [...feature.optionalRequires],
      configReads: [...feature.configReads],
      exposesApis: [...feature.exposedApis],
      usesApis: [...feature.usedApis],
      extensionsUsed: feature.extensionUsages.map((usage) => ({
        extensionName: usage.extensionName,
        entityName: usage.entityName,
      })),
      configKeys,
      secrets,
    });
  }

  manifestFeatures.sort((a, b) => a.name.localeCompare(b.name));

  return {
    source: "samples/apps/use-all-bundled APP_FEATURES (composeFeatures includeBundled)",
    featureCount: manifestFeatures.length,
    features: manifestFeatures,
  };
}

export const MANIFEST_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "feature-manifest.json",
);

export function serializeManifest(manifest: FeatureManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifest = buildFeatureManifest();
  writeFileSync(MANIFEST_PATH, serializeManifest(manifest), "utf-8");
  console.log(`feature-manifest.json: ${manifest.featureCount} features → ${MANIFEST_PATH}`);
}

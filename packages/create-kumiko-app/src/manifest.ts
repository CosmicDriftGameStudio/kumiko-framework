// Loads the vendored feature-manifest.json (copied from
// samples/apps/use-all-bundled by scripts/vendor-manifest.ts) at runtime.
// The published package ships the JSON next to package.json so the picker
// works without network access — the source-of-truth at build time is the
// sample-app's manifest, kept in sync via a CI drift-test.

import { readFileSync } from "node:fs";
import { parseJsonOrThrow } from "@cosmicdrift/kumiko-framework/utils";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ManifestUiHintOption =
  | {
      readonly key: string;
      readonly label: string;
      readonly type: "boolean";
      readonly default: boolean;
    }
  | {
      readonly key: string;
      readonly label: string;
      readonly type: "select";
      readonly options: readonly string[];
      readonly default: string;
    }
  | {
      readonly key: string;
      readonly label: string;
      readonly type: "text";
      readonly default?: string;
    };

export type ManifestUiHints = {
  readonly displayLabel?: string;
  readonly category?: string;
  readonly recommended?: boolean;
  readonly configurableOptions?: readonly ManifestUiHintOption[];
};

export type ManifestFeatureEntry = {
  readonly name: string;
  readonly description: string | null;
  readonly requires: readonly string[];
  readonly optionalRequires: readonly string[];
  readonly uiHints?: ManifestUiHints;
};

export type Manifest = {
  readonly source: string;
  readonly featureCount: number;
  readonly features: readonly ManifestFeatureEntry[];
};

const HERE = dirname(fileURLToPath(import.meta.url));

export function loadManifest(): Manifest {
  const path = resolve(HERE, "..", "feature-manifest.json");
  const raw = readFileSync(path, "utf-8");
  return parseJsonOrThrow<Manifest>(raw, "feature-manifest.json");
}

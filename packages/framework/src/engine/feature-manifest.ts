// Runtime-introspected feature manifest — shared extraction logic for
// `gen-feature-manifest.ts` (use-all-bundled) and the enterprise generator.
// These were previously two nearly identical forks with diverging schemas:
// when framework introspection was extended, the copy silently drifted. The
// booted Registry is authoritative because the AST parser cannot read the
// imperative factory helpers of bundled features.

import { SYSTEM_EVENT_PREFIX } from "../crypto/system-event-pii.ts";
import { compareByCodepoint } from "../utils/compare.ts";

import { isEncryptedAtRest } from "./config-helpers.ts";
import { qualifyEntityName } from "./qualified-name.ts";
import type { Registry, UiHints } from "./types/feature.ts";

export type ManifestConfigKey = {
  readonly key: string;
  readonly qualifiedName: string;
  readonly type: "text" | "number" | "boolean" | "select";
  readonly scope: string;
  readonly default: string | number | boolean | null;
  readonly encrypted: boolean;
  readonly computed: boolean;
  readonly validated: boolean;
  readonly options: readonly string[] | null;
  readonly bounds: { readonly min?: number; readonly max?: number } | null;
  // Serializable write-time validator for type="text" keys (hex/https/length).
  // Carried into the manifest as ConfigKeyDefinition.pattern's JSDoc promises
  // (feature-manifest, docgen) — was previously dropped by this serializer.
  readonly pattern: { readonly regex: string; readonly flags?: string } | null;
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

/** Framework-owned registered event (`kumiko:system:*`), e.g. the workflow
 *  run-stream events a projection can apply. Not owned by any feature. */
export type ManifestSystemEvent = {
  readonly name: string;
  readonly version: number;
};

export type ManifestFeature = {
  readonly name: string;
  readonly description: string | null;
  readonly toggleableDefault: boolean | null;
  readonly adoptsBundledLists?: true;
  readonly requires: readonly string[];
  readonly optionalRequires: readonly string[];
  readonly configReads: readonly string[];
  readonly exposesApis: readonly string[];
  readonly usesApis: readonly string[];
  readonly extensionsUsed: readonly ManifestExtension[];
  readonly configKeys: readonly ManifestConfigKey[];
  readonly secrets: readonly ManifestSecret[];
  /** All registered write-handler QNs for this feature
   *  (e.g. "user:write:user:create", "auth-email-password:write:login").
   *  Derived from `collectWriteHandlerQns` and used as the source of truth
   *  for client-side type checking of `dispatcher.write` calls. */
  readonly writeHandlers: readonly string[];
  /** Picker/scaffolder UI metadata declared via r.uiHints(). Optional —
   *  absent for features that haven't been annotated yet (the picker falls
   *  back to feature.name + feature.description). */
  readonly uiHints?: UiHints;
  /** Optionaler Herkunfts-Tag (z.B. "enterprise") — gesetzt via Options. */
  readonly tier?: string;
};

export type FeatureManifest = {
  readonly source: string;
  readonly featureCount: number;
  readonly features: readonly ManifestFeature[];
  // Optional so hand-built manifests from before this field stay valid.
  readonly systemEvents?: readonly ManifestSystemEvent[];
  readonly tier?: string;
};

const CONFIG_SEGMENT = ":config:";

export type BuildManifestOptions = {
  /** Description of the manifest's origin, included unchanged in the JSON. */
  readonly source: string;
  /** Emit only these features (e.g. the 16 enterprise features from a
   *  Registry that also mounted their bundled requirements). Default:
   *  all features in the Registry. */
  readonly featureNames?: ReadonlySet<string>;
  /** Tags each feature and the top-level manifest (e.g. "enterprise"). */
  readonly tier?: string;
};

export function buildManifestFromRegistry(
  registry: Registry,
  options: BuildManifestOptions,
): FeatureManifest {
  const allConfigKeys = registry.getAllConfigKeys();
  const allSecretKeys = registry.getAllSecretKeys();

  const manifestFeatures: ManifestFeature[] = [];
  for (const feature of registry.features.values()) {
    if (options.featureNames !== undefined && !options.featureNames.has(feature.name)) continue;

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
        encrypted: isEncryptedAtRest(def),
        computed: def.computed !== undefined,
        validated: def.validate !== undefined,
        options: def.options ?? null,
        bounds: def.bounds ?? null,
        pattern: def.pattern ?? null,
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

    const writeHandlerQns: string[] = [];
    for (const handlerName of Object.keys(feature.writeHandlers)) {
      writeHandlerQns.push(qualifyEntityName(feature.name, "write", handlerName));
    }

    configKeys.sort((a, b) => compareByCodepoint(a.qualifiedName, b.qualifiedName));
    secrets.sort((a, b) => compareByCodepoint(a.qualifiedName, b.qualifiedName));
    writeHandlerQns.sort(compareByCodepoint);

    manifestFeatures.push({
      name: feature.name,
      description: feature.description ?? null,
      toggleableDefault: feature.toggleableDefault ?? null,
      ...(feature.adoptsBundledLists && { adoptsBundledLists: true as const }),
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
      writeHandlers: writeHandlerQns,
      ...(feature.uiHints !== undefined && { uiHints: feature.uiHints }),
      ...(options.tier !== undefined && { tier: options.tier }),
    });
  }

  manifestFeatures.sort((a, b) => compareByCodepoint(a.name, b.name));

  const systemEvents: ManifestSystemEvent[] = [];
  for (const [name, info] of registry.getEventUpcasters()) {
    if (name.startsWith(SYSTEM_EVENT_PREFIX))
      systemEvents.push({ name, version: info.currentVersion });
  }
  systemEvents.sort((a, b) => compareByCodepoint(a.name, b.name));

  return {
    source: options.source,
    featureCount: manifestFeatures.length,
    features: manifestFeatures,
    systemEvents,
    ...(options.tier !== undefined && { tier: options.tier }),
  };
}

export function serializeManifest(manifest: FeatureManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

// Runtime-introspected feature-manifest — die geteilte Extraktionslogik
// hinter `gen-feature-manifest.ts` (use-all-bundled) und dem enterprise-
// Generator. Vorher waren das zwei fast wortgleiche Forks mit divergentem
// Schema (enterprise#95): erweitert das Framework die Introspektion, driftete
// die Kopie still. Quelle der Wahrheit ist die GEBOOTETE Registry — der
// AST-Parser kann die imperativen Factory-Helper der bundled features nicht
// lesen.

import { compareByCodepoint } from "../utils";
import { qualifyEntityName } from "./qualified-name";
import type { Registry } from "./types/feature";

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

export type ManifestFeature = {
  readonly name: string;
  readonly description: string | null;
  readonly toggleableDefault: boolean | null;
  readonly requires: readonly string[];
  readonly optionalRequires: readonly string[];
  readonly configReads: readonly string[];
  readonly exposesApis: readonly string[];
  readonly usesApis: readonly string[];
  readonly extensionsUsed: readonly ManifestExtension[];
  readonly configKeys: readonly ManifestConfigKey[];
  readonly secrets: readonly ManifestSecret[];
  /** Alle registrierten Write-Handler-QNs dieses Features
   *  (z.B. "user:write:user:create", "auth-email-password:write:login").
   *  Von `collectWriteHandlerQns` abgeleitet — dient als Source-of-Truth
   *  für den Client-seitigen Typcheck von `dispatcher.write`-Calls. */
  readonly writeHandlers: readonly string[];
  /** Optionaler Herkunfts-Tag (z.B. "enterprise") — gesetzt via Options. */
  readonly tier?: string;
};

export type FeatureManifest = {
  readonly source: string;
  readonly featureCount: number;
  readonly features: readonly ManifestFeature[];
  readonly tier?: string;
};

const CONFIG_SEGMENT = ":config:";

export type BuildManifestOptions = {
  /** Herkunfts-Beschreibung fürs Manifest (landet 1:1 im JSON). */
  readonly source: string;
  /** Nur diese Features emittieren (z.B. die 16 enterprise-Features einer
   *  Registry, die auch deren bundled-requires gemountet hat). Default:
   *  alle Features der Registry. */
  readonly featureNames?: ReadonlySet<string>;
  /** Taggt jedes Feature + das Manifest top-level (z.B. "enterprise"). */
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
        encrypted: def.encrypted ?? false,
        computed: def.computed !== undefined,
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
      ...(options.tier !== undefined && { tier: options.tier }),
    });
  }

  manifestFeatures.sort((a, b) => compareByCodepoint(a.name, b.name));

  return {
    source: options.source,
    featureCount: manifestFeatures.length,
    features: manifestFeatures,
    ...(options.tier !== undefined && { tier: options.tier }),
  };
}

export function serializeManifest(manifest: FeatureManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

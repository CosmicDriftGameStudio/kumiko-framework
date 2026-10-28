import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "ts-morph";
import { type FeatureImport, featureImport } from "./agent-docs-feature-imports";
import {
  codeList,
  compareCodepoint,
  finishFile,
  firstSentence,
  isRecord,
  parseJsonFile,
  table,
} from "./agent-docs-shared";

const FEATURE_MANIFEST_REL = "samples/apps/use-all-bundled/feature-manifest.json";

type ManifestConfigKeyDoc = {
  readonly key: string;
  readonly type: string;
  readonly scope: string;
  readonly default: string | number | boolean | null;
};

type ManifestSecretDoc = {
  readonly qualifiedName: string;
  readonly scope: string;
  readonly label: string | null;
};

type ManifestFeatureDoc = {
  readonly name: string;
  readonly description: string | null;
  readonly category: string | null;
  readonly requires: readonly string[];
  readonly optionalRequires: readonly string[];
  readonly exposesApis: readonly string[];
  readonly usesApis: readonly string[];
  readonly configKeys: readonly ManifestConfigKeyDoc[];
  readonly secrets: readonly ManifestSecretDoc[];
};

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isConfigKeyDoc(value: unknown): value is ManifestConfigKeyDoc {
  if (!isRecord(value)) return false;
  const fallback = value["default"];
  return (
    typeof value["key"] === "string" &&
    typeof value["type"] === "string" &&
    typeof value["scope"] === "string" &&
    (fallback === null ||
      typeof fallback === "string" ||
      typeof fallback === "number" ||
      typeof fallback === "boolean")
  );
}

function isSecretDoc(value: unknown): value is ManifestSecretDoc {
  return (
    isRecord(value) &&
    typeof value["qualifiedName"] === "string" &&
    typeof value["scope"] === "string" &&
    isNullableString(value["label"])
  );
}

function parseFeatureDoc(value: unknown): ManifestFeatureDoc | undefined {
  if (!isRecord(value) || typeof value["name"] !== "string") return undefined;
  const description = value["description"];
  const configKeys = value["configKeys"];
  const secrets = value["secrets"];
  const uiHints = value["uiHints"];
  const category = isRecord(uiHints) ? uiHints["category"] : undefined;
  if (
    !isNullableString(description) ||
    !isStringArray(value["requires"]) ||
    !isStringArray(value["optionalRequires"]) ||
    !isStringArray(value["exposesApis"]) ||
    !isStringArray(value["usesApis"]) ||
    !Array.isArray(configKeys) ||
    !configKeys.every(isConfigKeyDoc) ||
    !Array.isArray(secrets) ||
    !secrets.every(isSecretDoc)
  ) {
    return undefined;
  }
  return {
    name: value["name"],
    description,
    category: typeof category === "string" ? category : null,
    requires: value["requires"],
    optionalRequires: value["optionalRequires"],
    exposesApis: value["exposesApis"],
    usesApis: value["usesApis"],
    configKeys,
    secrets,
  };
}

function readFeatureManifest(repoRoot: string): readonly ManifestFeatureDoc[] {
  const raw = readFileSync(join(repoRoot, FEATURE_MANIFEST_REL), "utf-8");
  const parsed = parseJsonFile(FEATURE_MANIFEST_REL, raw);
  const features = isRecord(parsed) ? parsed["features"] : undefined;
  if (!Array.isArray(features)) {
    throw new Error(`${FEATURE_MANIFEST_REL}: "features" must be an array`);
  }
  const docs = features.map((entry, index) => {
    const feature = parseFeatureDoc(entry);
    if (feature === undefined) {
      throw new Error(`${FEATURE_MANIFEST_REL}: features[${index}] has an unexpected shape`);
    }
    return feature;
  });
  return docs.sort((left, right) => compareCodepoint(left.name, right.name));
}

function renderFeatureSection(feature: ManifestFeatureDoc): string {
  const parts = [`## ${feature.name}`];
  if (feature.description !== null) parts.push(feature.description.replace(/\s+/g, " ").trim());
  if (feature.category !== null) parts.push(`Category: ${feature.category}`);
  if (feature.requires.length > 0) parts.push(`Requires: ${codeList(feature.requires)}`);
  if (feature.optionalRequires.length > 0) {
    parts.push(`Optional requires: ${codeList(feature.optionalRequires)}`);
  }
  if (feature.configKeys.length > 0) {
    const rows = feature.configKeys.map((configKey) => [
      `\`${configKey.key}\``,
      configKey.type,
      configKey.scope,
      configKey.default === null ? "" : `\`${String(configKey.default)}\``,
    ]);
    parts.push(`Config keys:\n\n${table(["Key", "Type", "Scope", "Default"], rows)}`);
  }
  if (feature.secrets.length > 0) {
    const rows = feature.secrets.map((secret) => [
      `\`${secret.qualifiedName}\``,
      secret.scope,
      secret.label ?? "",
    ]);
    parts.push(`Secrets:\n\n${table(["Secret", "Scope", "Label"], rows)}`);
  }
  if (feature.exposesApis.length > 0) parts.push(`Exposes APIs: ${codeList(feature.exposesApis)}`);
  if (feature.usesApis.length > 0) parts.push(`Uses APIs: ${codeList(feature.usesApis)}`);
  return parts.join("\n\n");
}

export type FeatureDocs = {
  readonly features: string;
  readonly featuresIndex: string;
};

function importLine(found: FeatureImport | undefined): string {
  if (found === undefined) return "Import: no factory found in the package exports";
  return `\`import { ${found.exportNames.join(", ")} } from "${found.importPath}"\``;
}

function renderIndexEntry(feature: ManifestFeatureDoc, found: FeatureImport | undefined): string {
  const purpose = feature.description === null ? "" : ` ${firstSentence(feature.description)}`;
  const details = [importLine(found)];
  if (feature.requires.length > 0) details.push(`requires ${codeList(feature.requires)}`);
  const unset = feature.configKeys.filter((configKey) => configKey.default === null);
  if (unset.length > 0) {
    details.push(`config without default ${codeList(unset.map((configKey) => configKey.key))}`);
  }
  if (feature.secrets.length > 0) {
    details.push(`secrets ${codeList(feature.secrets.map((secret) => secret.qualifiedName))}`);
  }
  return `- \`${feature.name}\`:${purpose}\n  ${details.join("; ")}`;
}

const INDEX_INTRO =
  "One entry per bundled feature: purpose, import of its factory, required features, config keys without a default and secrets. Factory options: `api/` or the feature's types. Details: `features.md`.";

export function renderFeatureDocs(repoRoot: string, project: Project): FeatureDocs {
  const manifest = readFeatureManifest(repoRoot);
  const sections = manifest.map(renderFeatureSection);
  const entries = manifest.map((feature) =>
    renderIndexEntry(feature, featureImport(repoRoot, project, feature.name)),
  );
  return {
    features: finishFile(FEATURE_MANIFEST_REL, `# Bundled features\n\n${sections.join("\n\n")}`),
    featuresIndex: finishFile(
      FEATURE_MANIFEST_REL,
      `# Bundled features index\n\n${INDEX_INTRO}\n\n${entries.join("\n")}`,
    ),
  };
}

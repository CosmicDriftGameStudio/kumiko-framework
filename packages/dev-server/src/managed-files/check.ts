import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mergeBunfig } from "@cosmicdrift/kumiko-testing/bunfig";
import { parseJsonc } from "./jsonc.js";
import { renderLineDiff } from "./line-diff.js";
import { readManagedMarker, stripManagedMarker } from "./marker.js";
import {
  BIOME_PRESET,
  listManagedFiles,
  type ManagedAppFacts,
  type ManagedBunfigFile,
  type ManagedFile,
  type ManagedStructuralFile,
  type ManagedTemplateFile,
  renderManagedBunfig,
  TSCONFIG_PRESET,
} from "./registry.js";

export type ManagedFileState =
  | { readonly state: "ok" }
  | { readonly state: "missing" }
  /** `-` lines: template, `+` lines: repo. */
  | { readonly state: "differs"; readonly diff: string }
  /** Exists without the marker; `diff` is set when the content also differs. */
  | { readonly state: "unmarked"; readonly diff?: string }
  | { readonly state: "local"; readonly reason: string }
  | { readonly state: "invalid"; readonly message: string };

export type ManagedFileReport = ManagedFileState & {
  readonly path: string;
  readonly kind: ManagedFile["kind"];
};

export type ManagedCheckResult = {
  /** kumiko.config.ts calls defineAppConfig: drift fails the check from then on. */
  readonly adopted: boolean;
  readonly files: readonly ManagedFileReport[];
};

function readIfExists(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf-8") : undefined;
}

function compareBodies(expected: string, actual: string): string | undefined {
  return expected === actual ? undefined : renderLineDiff(expected, actual);
}

function checkTemplate(file: ManagedTemplateFile, existing: string): ManagedFileState {
  const marker = readManagedMarker(existing);
  if (marker.kind === "invalid") return { state: "invalid", message: marker.message };
  if (marker.kind === "local") return { state: "local", reason: marker.reason };
  const diff = compareBodies(stripManagedMarker(file.content), stripManagedMarker(existing));
  if (marker.kind === "unmarked")
    return diff === undefined ? { state: "unmarked" } : { state: "unmarked", diff };
  return diff === undefined ? { state: "ok" } : { state: "differs", diff };
}

function checkBunfig(file: ManagedBunfigFile, existing: string): ManagedFileState {
  const marker = readManagedMarker(existing);
  if (marker.kind === "invalid") return { state: "invalid", message: marker.message };
  if (marker.kind === "local") return { state: "local", reason: marker.reason };
  const merged = mergeBunfig(renderManagedBunfig(file, existing), existing);
  if (!merged.ok) {
    const keys = merged.unknownKeys.map(({ section, key }) => `[${section}] ${key}`).join(", ");
    return { state: "invalid", message: `keys the generator does not own: ${keys}` };
  }
  const diff = compareBodies(merged.content, existing);
  if (marker.kind === "unmarked")
    return diff === undefined ? { state: "unmarked" } : { state: "unmarked", diff };
  return diff === undefined ? { state: "ok" } : { state: "differs", diff };
}

function extendsList(value: unknown): readonly unknown[] {
  if (typeof value !== "object" || value === null || !("extends" in value)) return [];
  const extendsValue = value.extends;
  return Array.isArray(extendsValue) ? extendsValue : [extendsValue];
}

function checkStructural(
  file: ManagedStructuralFile,
  facts: ManagedAppFacts,
  existing: string,
): ManagedFileState {
  if (file.path === "kumiko.config.ts") {
    switch (facts.config.kind) {
      case "defined":
        return { state: "ok" };
      case "legacy":
        return {
          state: "invalid",
          message:
            "default-export defineAppConfig({ features, client, ports }) from @cosmicdrift/kumiko-framework/config",
        };
      case "invalid":
        return { state: "invalid", message: facts.config.message };
      case "missing":
        return { state: "missing" };
    }
  }
  const preset = file.path === "biome.json" ? BIOME_PRESET : TSCONFIG_PRESET;
  let parsed: unknown;
  try {
    parsed = parseJsonc(existing, file.path);
  } catch (error) {
    return {
      state: "invalid",
      message: `cannot parse: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return extendsList(parsed).includes(preset)
    ? { state: "ok" }
    : { state: "invalid", message: `must extend "${preset}"; keep app overrides below extends` };
}

function checkFile(file: ManagedFile, facts: ManagedAppFacts): ManagedFileState {
  if (file.kind === "structural" && file.path === "kumiko.config.ts") {
    return checkStructural(file, facts, "");
  }
  const existing = readIfExists(join(facts.appRoot, file.path));
  if (existing === undefined) return { state: "missing" };
  switch (file.kind) {
    case "template":
      return checkTemplate(file, existing);
    case "bunfig":
      return checkBunfig(file, existing);
    case "structural":
      return checkStructural(file, facts, existing);
    case "seed":
      return { state: "ok" };
  }
}

export function checkManagedFiles(facts: ManagedAppFacts): ManagedCheckResult {
  return {
    adopted: facts.config.kind === "defined",
    files: listManagedFiles(facts).map((file) => ({
      path: file.path,
      kind: file.kind,
      ...checkFile(file, facts),
    })),
  };
}

/** States that fail `kumiko check managed` once the app has adopted kumiko.config.ts. */
export function isManagedDrift(report: ManagedFileReport): boolean {
  return report.state !== "ok" && report.state !== "local";
}

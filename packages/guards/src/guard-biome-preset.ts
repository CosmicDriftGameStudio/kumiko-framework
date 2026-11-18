#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { type RepoCheck, reportResults, runRepoChecks } from "./_lib/guard-kit";

const PRESET_PACKAGE_EXTENDS: ReadonlySet<string> = new Set([
  "@cosmicdrift/kumiko-framework/biome-rules",
  "@cosmicdrift/kumiko-framework/biome",
]);
const PRESET_FILE_SUFFIXES = ["/presets/biome-rules.json", "/presets/biome-app.json"];
const BIOME_CONFIG_NAMES = ["biome.json", "biome.jsonc"];

export const BIOME_PRESET_FIX = '"extends": ["@cosmicdrift/kumiko-framework/biome"]';

function readExtendsList(configPath: string): string[] {
  let parsed: unknown;
  try {
    parsed = Bun.JSONC.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return [];
  }
  const list =
    typeof parsed === "object" && parsed !== null && "extends" in parsed
      ? parsed.extends
      : undefined;
  const entries = Array.isArray(list) ? list : [list];
  return entries.filter((entry): entry is string => typeof entry === "string");
}

function extendsFrameworkPreset(configPath: string, visited: Set<string>): boolean {
  if (visited.has(configPath)) return false;
  visited.add(configPath);
  return readExtendsList(configPath).some((entry) => {
    if (PRESET_PACKAGE_EXTENDS.has(entry)) return true;
    if (!entry.startsWith(".")) return false;
    const target = resolve(dirname(configPath), entry);
    if (PRESET_FILE_SUFFIXES.some((suffix) => target.endsWith(suffix))) return true;
    return existsSync(target) && extendsFrameworkPreset(target, visited);
  });
}

export function repoExtendsFrameworkPreset(repoRoot: string): boolean {
  const configPath = BIOME_CONFIG_NAMES.map((name) => join(repoRoot, name)).find((candidate) =>
    existsSync(candidate),
  );
  return configPath !== undefined && extendsFrameworkPreset(configPath, new Set());
}

export const check: RepoCheck = {
  name: "biome-preset",
  hint: `Add ${BIOME_PRESET_FIX} to biome.json — without the preset the SSRF, path-traversal, event-store-write and admin-API plugins do not run.`,
  run(roots) {
    const appRoots = roots.filter((root) => root.kind === "app");
    const violations = appRoots
      .filter((root) => !repoExtendsFrameworkPreset(root.absPath))
      .map((root) => ({
        file: join(root.absPath, "biome.json"),
        line: 1,
        message: "biome.json does not extend the Kumiko Biome preset.",
      }));
    return {
      violations,
      matchedFiles: appRoots.length,
      notApplicable: appRoots.length === 0,
    };
  },
};

if (import.meta.main) {
  const failed = reportResults(await runRepoChecks([check]));
  process.exit(failed > 0 ? 1 : 0);
}

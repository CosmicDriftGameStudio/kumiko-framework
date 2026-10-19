#!/usr/bin/env bun
// package-merge — packages folded into another package keep working as shims for one wave and are
// then removed; this rewrites the consumer side of each move:
//   import/export/import()/mock.module specifiers (incl. subpaths) -> the new specifier
//   package.json dependencies/devDependencies/peerDependencies     -> old entry out, new entry in
//     (same version range, same block, skipped when the block already has it)
// New moves are rows in PACKAGE_MERGE_MAPPINGS; nothing else changes.
//
// Usage:
//   bun scripts/codemod/package-merge.ts <targetDir...> [--check | --dry-run | --write] [--no-format]
// Without a mode flag it writes (kumiko-upgrade --apply calls it that way). --check exits 1
// while any rewritable site is left; --dry-run only reports.

import { Node, Project } from "ts-morph";
import {
  applyEdits,
  type CodemodResult,
  moduleSpecifierLiterals,
  runCodemodCli,
  type SiteLists,
  type TextEdit,
} from "./codemod-support.ts";

export interface PackageMergeMapping {
  readonly from: string;
  readonly to: string;
}

// A `from` also matches its subpaths: `<from>/x` becomes `<to>/x`. Longer rows win over shorter ones.
export const PACKAGE_MERGE_MAPPINGS: readonly PackageMergeMapping[] = [
  { from: "@cosmicdrift/kumiko-http", to: "@cosmicdrift/kumiko-framework/http" },
  {
    from: "@cosmicdrift/kumiko-repo-manifest",
    to: "@cosmicdrift/kumiko-guards/repo-manifest",
  },
  { from: "@cosmicdrift/kumiko-headless", to: "@cosmicdrift/kumiko-renderer/headless" },
  { from: "@cosmicdrift/kumiko-dispatcher-live", to: "@cosmicdrift/kumiko-renderer/live" },
];

const DEPENDENCY_BLOCKS = ["dependencies", "devDependencies", "peerDependencies"] as const;

const SKIPPED_PATH_SUFFIXES: readonly string[] = [
  "packages/http/src/index.ts",
  "packages/repo-manifest/src/index.ts",
  "packages/repo-manifest/src/app-ports/index.ts",
  "packages/headless/src/index.ts",
  "packages/headless/src/apex/index.ts",
  "packages/headless/src/dispatcher/index.ts",
  "packages/headless/src/locale-routing/index.ts",
  "packages/dispatcher-live/src/index.ts",
  "packages/framework/src/scripts/codemod/package-merge.ts",
  "packages/framework/src/__tests__/package-merge-codemod.test.ts",
];

function packageNameOf(specifier: string): string {
  const [scope, name] = specifier.split("/");
  return specifier.startsWith("@") ? `${scope}/${name}` : (scope ?? specifier);
}

function mappingsLongestFirst(mappings: readonly PackageMergeMapping[]): PackageMergeMapping[] {
  return [...mappings].sort((a, b) => b.from.length - a.from.length);
}

export function mergedSpecifier(
  specifier: string,
  mappings: readonly PackageMergeMapping[] = PACKAGE_MERGE_MAPPINGS,
): string | undefined {
  for (const { from, to } of mappingsLongestFirst(mappings)) {
    if (specifier === from) return to;
    if (specifier.startsWith(`${from}/`)) return `${to}${specifier.slice(from.length)}`;
  }
  return undefined;
}

function movedPackages(mappings: readonly PackageMergeMapping[]): Map<string, string> {
  const moved = new Map<string, string>();
  for (const { from, to } of mappings) {
    if (packageNameOf(from) === from) moved.set(from, packageNameOf(to));
  }
  return moved;
}

function transformTypeScriptSource(
  source: string,
  filePath: string,
  mappings: readonly PackageMergeMapping[],
  result: SiteLists,
): string {
  if (!mappings.some(({ from }) => source.includes(from))) return source;
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
  const sourceFile = project.createSourceFile(filePath, source);
  const edits: TextEdit[] = [];
  for (const literal of moduleSpecifierLiterals(sourceFile)) {
    if (!Node.isStringLiteral(literal)) continue;
    const current = literal.getLiteralValue();
    const next = mergedSpecifier(current, mappings);
    if (next === undefined) continue;
    result.rewrites.push({
      file: filePath,
      line: literal.getStartLineNumber(),
      description: `${current} -> ${next}`,
    });
    edits.push({ start: literal.getStart(), end: literal.getEnd(), text: JSON.stringify(next) });
  }
  return applyEdits(source, edits);
}

function detectIndent(source: string): string {
  return /^([ \t]+)"/m.exec(source)?.[1] ?? "  ";
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function isSortedKeys(record: Record<string, string>): boolean {
  const keys = Object.keys(record);
  return keys.every((key, index) => index === 0 || (keys[index - 1] ?? "") <= key);
}

function mergeDependencyBlock(
  block: Record<string, string>,
  moved: ReadonlyMap<string, string>,
  ownName: unknown,
  describe: (description: string) => void,
): Record<string, string> | undefined {
  const next: Record<string, string> = {};
  let changed = false;
  for (const [name, range] of Object.entries(block)) {
    const target = moved.get(name);
    if (target === undefined) {
      next[name] = range;
      continue;
    }
    changed = true;
    describe(`${name} -> ${target}`);
    if (target !== ownName && !(target in block)) next[target] = range;
  }
  if (!changed) return undefined;
  return isSortedKeys(block)
    ? Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)))
    : next;
}

function transformPackageJson(
  source: string,
  filePath: string,
  mappings: readonly PackageMergeMapping[],
  result: SiteLists,
): string {
  let manifest: unknown;
  try {
    manifest = JSON.parse(source);
  } catch {
    result.manual.push({ file: filePath, line: 1, description: "package.json is not valid JSON" });
    return source;
  }
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) return source;
  const moved = movedPackages(mappings);
  const record: Record<string, unknown> = { ...manifest };
  let changed = false;
  for (const blockName of DEPENDENCY_BLOCKS) {
    const block = record[blockName];
    if (!isStringRecord(block)) continue;
    const merged = mergeDependencyBlock(block, moved, record["name"], (description) => {
      result.rewrites.push({
        file: filePath,
        line: 1,
        description: `${blockName}: ${description}`,
      });
    });
    if (merged === undefined) continue;
    record[blockName] = merged;
    changed = true;
  }
  if (!changed) return source;
  const trailingNewline = source.endsWith("\n") ? "\n" : "";
  return `${JSON.stringify(record, null, detectIndent(source))}${trailingNewline}`;
}

export function transformPackageMergeSource(
  source: string,
  filePath = "source.ts",
  mappings: readonly PackageMergeMapping[] = PACKAGE_MERGE_MAPPINGS,
): CodemodResult {
  const result: SiteLists = { rewrites: [], manual: [] };
  const output = filePath.endsWith("package.json")
    ? transformPackageJson(source, filePath, mappings, result)
    : transformTypeScriptSource(source, filePath, mappings, result);
  return { output, ...result };
}

function isSkippedPath(file: string): boolean {
  return SKIPPED_PATH_SUFFIXES.some((suffix) => file.endsWith(suffix));
}

if (import.meta.main) {
  await runCodemodCli(
    {
      name: "package-merge",
      transform: (source, filePath) => transformPackageMergeSource(source, filePath),
      isSkippedPath,
      extraFileNames: ["package.json"],
    },
    process.argv.slice(2),
  );
}

#!/usr/bin/env bun
/**
 * Feature Import Cycles Guard — counts static runtime imports that close a cycle between two or more features, frozen per file in `.kumiko-feature-import-cycles-baseline.json`.
 *
 * ESM evaluates a cycle in import order, so a feature can read another's exports before they
 * are initialised. Type-only and dynamic imports are erased or deferred and do not count. A
 * missing baseline file counts as empty, so every existing hit fails until it is frozen with
 * `--write-baseline`.
 */

import path from "node:path";
import { Node, type SourceFile } from "ts-morph";
import {
  type AstGuard,
  baselineRatchet,
  buildSharedProject,
  filesForGuard,
  isLocalFinding,
  relFromRepoRoot,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";
import { fileIgnoreTagLine, hasIgnoreTag } from "./_lib/ignore-tag";
import { resolveRepoRoots } from "./_lib/roots";
import { locateFeature } from "./guard-cross-feature-imports";

const ROOT = process.cwd();

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts", "tsx"],
  frameworkWithin: ["packages/bundled-features/src/**", "samples/**/src/**"],
};

const IGNORE_SLUG = "feature-import-cycles";
const IGNORE_TAG = `kumiko-lint-ignore ${IGNORE_SLUG}`;

const featureImportCyclesBaseline = baselineRatchet({
  file: path.join(ROOT, ".kumiko-feature-import-cycles-baseline.json"),
  formatVersion: 1,
  unit: "cyclic feature import(s)",
});

interface ImportSite {
  readonly file: string;
  readonly from: string;
  readonly to: string;
}

function isErasedImport(decl: Node): boolean {
  if (Node.isImportDeclaration(decl)) {
    if (decl.isTypeOnly()) return true;
    const named = decl.getNamedImports();
    return (
      named.length > 0 &&
      decl.getDefaultImport() === undefined &&
      decl.getNamespaceImport() === undefined &&
      named.every((specifier) => specifier.isTypeOnly())
    );
  }
  if (Node.isExportDeclaration(decl)) {
    if (decl.isTypeOnly()) return true;
    const named = decl.getNamedExports();
    return named.length > 0 && named.every((specifier) => specifier.isTypeOnly());
  }
  return false;
}

function importSitesOf(
  sf: SourceFile,
  featureOf: (absPath: string) => string | null,
): ImportSite[] {
  const from = featureOf(sf.getFilePath());
  if (from === null || fileIgnoreTagLine(sf, IGNORE_SLUG) !== undefined) return [];
  const sites: ImportSite[] = [];
  for (const decl of [...sf.getImportDeclarations(), ...sf.getExportDeclarations()]) {
    if (decl.getModuleSpecifier() === undefined) continue;
    if (isErasedImport(decl) || hasIgnoreTag(decl, IGNORE_TAG)) continue;
    const target = decl.getModuleSpecifierSourceFile();
    if (target === undefined) continue;
    const to = featureOf(target.getFilePath());
    if (to !== null && to !== from) sites.push({ file: sf.getFilePath(), from, to });
  }
  return sites;
}

// Tarjan; returns the component id per feature.
function stronglyConnectedComponents(graph: ReadonlyMap<string, ReadonlySet<string>>): {
  readonly componentOf: ReadonlyMap<string, number>;
  readonly sizeOf: ReadonlyMap<number, number>;
} {
  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const componentOf = new Map<string, number>();
  const sizeOf = new Map<number, number>();
  let counter = 0;

  const visit = (node: string): void => {
    index.set(node, counter);
    lowLink.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of graph.get(node) ?? []) {
      if (!index.has(next)) {
        visit(next);
        lowLink.set(node, Math.min(lowLink.get(node) ?? 0, lowLink.get(next) ?? 0));
      } else if (onStack.has(next)) {
        lowLink.set(node, Math.min(lowLink.get(node) ?? 0, index.get(next) ?? 0));
      }
    }
    if (lowLink.get(node) !== index.get(node)) return;
    const id = sizeOf.size;
    let size = 0;
    for (let member = stack.pop(); member !== undefined; member = stack.pop()) {
      onStack.delete(member);
      componentOf.set(member, id);
      size += 1;
      if (member === node) break;
    }
    sizeOf.set(id, size);
  };

  for (const node of graph.keys()) {
    if (!index.has(node)) visit(node);
  }
  return { componentOf, sizeOf };
}

export function featureCycleFindings(
  files: readonly SourceFile[],
  featureOf: (absPath: string) => string | null,
): Record<string, number> {
  const sites = files.flatMap((sf) => importSitesOf(sf, featureOf));
  const graph = new Map<string, Set<string>>();
  for (const { from, to } of sites) {
    if (!graph.has(from)) graph.set(from, new Set());
    if (!graph.has(to)) graph.set(to, new Set());
    graph.get(from)?.add(to);
  }
  const { componentOf, sizeOf } = stronglyConnectedComponents(graph);

  const counts: Record<string, number> = {};
  for (const { file, from, to } of sites) {
    const component = componentOf.get(from);
    if (component === undefined || component !== componentOf.get(to)) continue;
    if ((sizeOf.get(component) ?? 0) < 2) continue;
    counts[file] = (counts[file] ?? 0) + 1;
  }
  return counts;
}

function repoRelativeCycleFindings(
  files: readonly SourceFile[],
  roots: ReadonlyArray<{ readonly absPath: string }>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [file, count] of Object.entries(
    featureCycleFindings(files, (absPath) => locateFeature(absPath)?.root ?? null),
  )) {
    const rel = relFromRepoRoot(file, roots);
    if (isLocalFinding({ file: rel })) counts[rel] = (counts[rel] ?? 0) + count;
  }
  return counts;
}

const REMEDIATION =
  "Break the cycle: move the shared piece into one of the features' side-effect-free contract.ts / schema, or into a separate read feature both depend on; import types with `import type`.";

export const guard: AstGuard = {
  name: "Feature Import Cycles",
  ignoreTag: IGNORE_TAG,
  scan: SCAN,
  hint: 'after a deliberate change: `kumiko-guards guards --write-baseline --guard="Feature Import Cycles"`',
  run: (files, roots = resolveRepoRoots()) => ({
    violations: featureImportCyclesBaseline.check(
      repoRelativeCycleFindings(files, roots),
      REMEDIATION,
      {
        formatDriftRemediation: `Run \`kumiko-guards guards --write-baseline --guard="Feature Import Cycles"\` once.`,
      },
    ),
  }),
  writeBaseline: (files, roots = resolveRepoRoots()) => {
    featureImportCyclesBaseline.write(repoRelativeCycleFindings(files, roots));
  },
};

if (import.meta.main) {
  if (process.argv.slice(2).includes("--write-baseline")) {
    const project = buildSharedProject([guard]);
    guard.writeBaseline?.(filesForGuard(project, guard));
    process.exit(0);
  }
  runStandalone(guard);
}

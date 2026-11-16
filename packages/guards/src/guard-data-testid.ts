#!/usr/bin/env bun
/**
 * Data-Testid Guard — `data-testid` / `data-test` hooks in production code are frozen per file in `.kumiko-data-testid-baseline.json` and may not grow; tests select by role, label or text (workspace decision 2026-09-22 "no test hooks in production code"). Without a baseline file (consumer repos) it only warns.
 *
 * Counted: JSX attributes and `"data-testid"` object keys (spread props such as
 * `{...(id !== undefined && { "data-testid": id })}`). Excluded: tests,
 * declaration files and generated files.
 */

import path from "node:path";
import { type SourceFile, SyntaxKind } from "ts-morph";
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
import { resolveRepoRoots } from "./_lib/roots";

const ROOT = process.cwd();

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts", "tsx"],
  frameworkWithin: ["packages/*/src/**"],
};

const EXCLUDE =
  /(__tests__|\.test\.(ts|tsx)$|\.integration\.(ts|tsx)$|\.d\.(ts|tsx)$|\.generated\.(ts|tsx)$|\/generated\/)/;

const TEST_HOOK_ATTRIBUTES = new Set(["data-testid", "data-test"]);

const dataTestidBaseline = baselineRatchet({
  file: path.join(ROOT, ".kumiko-data-testid-baseline.json"),
  formatVersion: 1,
  unit: "data-testid hook(s)",
});

function countHooks(sf: SourceFile): number {
  const jsxHooks = sf
    .getDescendantsOfKind(SyntaxKind.JsxAttribute)
    .filter((attr) => TEST_HOOK_ATTRIBUTES.has(attr.getNameNode().getText())).length;
  const objectKeyHooks = sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment).filter((prop) => {
    const name = prop.getNameNode();
    return (
      name.getKind() === SyntaxKind.StringLiteral &&
      TEST_HOOK_ATTRIBUTES.has(name.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText())
    );
  }).length;
  return jsxHooks + objectKeyHooks;
}

export function dataTestidCounts(
  files: readonly SourceFile[],
  roots: ReadonlyArray<{ readonly absPath: string }> = resolveRepoRoots(),
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const sf of files) {
    if (EXCLUDE.test(sf.getFilePath())) continue;
    const count = countHooks(sf);
    if (count === 0) continue;
    counts[relFromRepoRoot(sf.getFilePath(), roots)] = count;
  }
  return counts;
}

function localOnly(counts: Readonly<Record<string, number>>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).filter(([file]) => isLocalFinding({ file })));
}

const REMEDIATION =
  "Select by role, label or text in the test instead of adding a data-testid hook; do not grow a frozen file.";

export const guard: AstGuard = {
  name: "Data-Testid Guard",
  scan: SCAN,
  hint: 'after a deliberate change: `kumiko-guards guards --write-baseline --guard="Data-Testid Guard"`',
  run: (files, roots = resolveRepoRoots()) => {
    const counts = localOnly(dataTestidCounts(files, roots));
    return {
      violations: dataTestidBaseline.check(counts, REMEDIATION, {
        formatDriftRemediation: `Run \`kumiko-guards guards --write-baseline --guard="Data-Testid Guard"\` once.`,
      }),
    };
  },
  writeBaseline: (files, roots = resolveRepoRoots()) => {
    dataTestidBaseline.write(localOnly(dataTestidCounts(files, roots)));
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

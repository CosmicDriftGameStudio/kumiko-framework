#!/usr/bin/env bun
/**
 * Test-Env-Writes Guard — direct writes to `process.env` / `Bun.env` in tests are frozen
 * per file in `.kumiko-test-env-writes-baseline.json` and may not grow; tests set env through
 * `withEnv`, `withEnvForEachTest` or `withEnvForSuite` so the previous value is always
 * restored. A missing baseline file counts as an empty baseline, so every existing hit fails
 * until it is frozen with `--write-baseline`.
 *
 * Counted: assignments (`=`, `??=`, `||=`, `&&=`, `+=`) to the env object or one of its
 * properties, `delete process.env.X` and `Object.assign(process.env, …)`.
 *
 * Usage (framework dev checkout):
 *   bun guards/guard-test-env-writes.ts
 * Consumer (via the published `kumiko-guards` CLI):
 *   kumiko-guards guards --guard=test-env-writes
 */

import path from "node:path";
import { Node, type SourceFile, SyntaxKind } from "ts-morph";
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

// Same reach as test-timeouts: Playwright dirs sit outside every manifest's testGlobs.
const SCAN: ScanSpec = {
  scope: "tests",
  extensions: ["ts", "tsx"],
  extraGlobs: [
    "e2e/**/*.{ts,tsx}",
    "packages/*/e2e/**/*.{ts,tsx}",
    "packages/*/src/e2e/**/*.{ts,tsx}",
    "samples/e2e/**/*.{ts,tsx}",
    "samples/recipes/*/e2e/**/*.{ts,tsx}",
    "samples/apps/*/e2e/**/*.{ts,tsx}",
  ],
};

const ENV_OBJECTS: ReadonlySet<string> = new Set(["process.env", "Bun.env"]);

const WRITE_OPERATORS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.EqualsToken,
  SyntaxKind.QuestionQuestionEqualsToken,
  SyntaxKind.BarBarEqualsToken,
  SyntaxKind.AmpersandAmpersandEqualsToken,
  SyntaxKind.PlusEqualsToken,
]);

const testEnvWritesBaseline = baselineRatchet({
  file: path.join(ROOT, ".kumiko-test-env-writes-baseline.json"),
  formatVersion: 1,
  unit: "direct env write(s)",
});

// The env object itself, or a property/element access on it.
function targetsEnv(node: Node): boolean {
  if (ENV_OBJECTS.has(node.getText())) return true;
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    return ENV_OBJECTS.has(node.getExpression().getText());
  }
  return false;
}

function countEnvWrites(sf: SourceFile): number {
  const assignments = sf
    .getDescendantsOfKind(SyntaxKind.BinaryExpression)
    .filter(
      (expr) => WRITE_OPERATORS.has(expr.getOperatorToken().getKind()) && targetsEnv(expr.getLeft()),
    ).length;
  const deletes = sf
    .getDescendantsOfKind(SyntaxKind.DeleteExpression)
    .filter((expr) => targetsEnv(expr.getExpression())).length;
  const assigns = sf.getDescendantsOfKind(SyntaxKind.CallExpression).filter((call) => {
    if (call.getExpression().getText() !== "Object.assign") return false;
    const [target] = call.getArguments();
    return target !== undefined && ENV_OBJECTS.has(target.getText());
  }).length;
  return assignments + deletes + assigns;
}

export function testEnvWriteCounts(
  files: readonly SourceFile[],
  roots: ReadonlyArray<{ readonly absPath: string }> = resolveRepoRoots(),
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const sf of files) {
    const count = countEnvWrites(sf);
    if (count === 0) continue;
    counts[relFromRepoRoot(sf.getFilePath(), roots)] = count;
  }
  return counts;
}

function localOnly(counts: Readonly<Record<string, number>>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).filter(([file]) => isLocalFinding({ file })));
}

const REMEDIATION =
  "Set env through withEnv / withEnvForEachTest / withEnvForSuite from @cosmicdrift/kumiko-testing/helpers; do not grow a frozen file.";

export const guard: AstGuard = {
  name: "test-env-writes",
  scan: SCAN,
  hint: 'after a deliberate change: `kumiko-guards guards --write-baseline --guard="test-env-writes"`',
  run: (files, roots = resolveRepoRoots()) => {
    const counts = localOnly(testEnvWriteCounts(files, roots));
    return {
      violations: testEnvWritesBaseline.check(counts, REMEDIATION, {
        formatDriftRemediation: `Run \`kumiko-guards guards --write-baseline --guard="test-env-writes"\` once.`,
      }),
    };
  },
  writeBaseline: (files, roots = resolveRepoRoots()) => {
    testEnvWritesBaseline.write(localOnly(testEnvWriteCounts(files, roots)));
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

#!/usr/bin/env bun
/**
 * Complexity check for handler hotspots with a baseline regression guard.
 *
 * Computes cyclomatic complexity per function/method (base 1, +1 per decision
 * point: if, for, while, case, catch, &&, ||, ??, ternary). Above the
 * threshold -> hotspot.
 *
 * Baseline regression guard like guard-comment-lang.ts: `.kumiko-complexity-
 * baseline.json` in the repo root pins the frozen hotspot count per file.
 *   - current <= baseline per file: PASS
 *   - current >  baseline per file: FAIL
 * Reductions do NOT update the baseline automatically — run `--write-baseline`
 * after refactor commits. Without a baseline file the check stays
 * warning-only (bootstrap: run `--write-baseline` once).
 * The baseline covers only files of the repo itself; sibling hotspots belong
 * in their own baseline (see localHotspots).
 *
 * Deliberate gap: hotspots are counted per file, not their height — an
 * already listed function may get more complex without the guard failing.
 *
 * Opt-out: `// kumiko-lint-ignore complexity-budget <reason>` on the function
 * line, the line above, or (for JSDoc-documented functions) the line above
 * the JSDoc block. The opt-out does NOT hold above HARD_COMPLEXITY_CAP: such a
 * function in the repo's own files always fails, regardless of baseline or tag.
 *
 * Usage:
 *   bun guards/check-complexity.ts                  # compare against baseline
 *   bun guards/check-complexity.ts --write-baseline # rewrite baseline
 *   bun guards/check-complexity.ts --no-baseline    # skip comparison
 *   bun guards/check-complexity.ts --all            # list every hotspot, not the first 30
 */

import * as path from "node:path";
import { Node, type SourceFile, SyntaxKind } from "ts-morph";
import {
  type AstGuard,
  baselineRatchet,
  buildSharedProject,
  filesForGuard,
  type GuardOutcome,
  type GuardViolation,
  isLocalFinding,
  relFromRepoRoot,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";
import { hasIgnoreTag, lineHasIgnoreTag } from "./_lib/ignore-tag";
import { type RepoRoot, resolveRepoRoots } from "./_lib/roots";

const ROOT = process.cwd();

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts"],
  frameworkWithin: ["packages/*/src/**"],
};

const EXCLUDE = /(__tests__|\.test\.ts$|\.integration\.ts$|\.d\.ts$)/;

const COMPLEXITY_THRESHOLD = 15;
const MAX_REPORTED = 30;
export const HARD_COMPLEXITY_CAP = 40;
const BUDGET_TAG = "kumiko-lint-ignore complexity-budget";

const FUNCTION_KINDS = [
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.FunctionExpression,
  SyntaxKind.ArrowFunction,
  SyntaxKind.MethodDeclaration,
  SyntaxKind.Constructor,
  SyntaxKind.GetAccessor,
  SyntaxKind.SetAccessor,
] as const;

export interface Hotspot {
  file: string;
  line: number;
  name: string;
  complexity: number;
}

function functionName(node: Node): string {
  if (
    Node.isFunctionDeclaration(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isGetAccessorDeclaration(node) ||
    Node.isSetAccessorDeclaration(node)
  ) {
    return node.getName() ?? "<anonymous>";
  }
  if (Node.isConstructorDeclaration(node)) return "constructor";
  // Arrow/function-expression assigned to a variable, object property, or
  // class property (`foo = () => {...}`): use that name.
  const parent = node.getParent();
  if (
    Node.isVariableDeclaration(parent) ||
    Node.isPropertyAssignment(parent) ||
    Node.isPropertyDeclaration(parent)
  ) {
    return parent.getName();
  }
  return "<anonymous>";
}

// hasIgnoreTag() only checks the node's own start line and the line above —
// for a JSDoc-documented function, "the line above" is the JSDoc's closing
// `*/`, not a line where a developer would naturally place a bare `//` tag.
// Extend the check to the line above the JSDoc block too.
function hasBudgetTag(fn: Node): boolean {
  if (hasIgnoreTag(fn, BUDGET_TAG)) return true;
  const jsDocStartLine = fn.getStartLineNumber(true);
  if (jsDocStartLine === fn.getStartLineNumber()) return false;
  const lines = fn.getSourceFile().getFullText().split("\n");
  return lineHasIgnoreTag(lines[jsDocStartLine - 2] ?? "", BUDGET_TAG);
}

const BRANCH_KINDS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.IfStatement,
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
  SyntaxKind.CatchClause,
  SyntaxKind.ConditionalExpression,
  SyntaxKind.CaseClause,
]);

const SHORT_CIRCUIT_OPERATORS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.AmpersandAmpersandToken,
  SyntaxKind.BarBarToken,
  SyntaxKind.QuestionQuestionToken,
]);

function isDecisionPoint(node: Node): boolean {
  const kind = node.getKind();
  if (BRANCH_KINDS.has(kind)) return true;
  if (kind !== SyntaxKind.BinaryExpression) return false;
  const operator = node.asKindOrThrow(SyntaxKind.BinaryExpression).getOperatorToken().getKind();
  return SHORT_CIRCUIT_OPERATORS.has(operator);
}

export function computeComplexity(fn: Node): number {
  let complexity = 1;
  fn.forEachDescendant((node, traversal) => {
    // skip: decision points inside a nested function-like node belong to its
    // own Hotspot entry
    if (node !== fn && FUNCTION_KINDS.some((kind) => kind === node.getKind())) {
      traversal.skip();
      return;
    }
    if (isDecisionPoint(node)) complexity++;
  });
  return complexity;
}

export interface FunctionMetric extends Hotspot {
  budgetTagged: boolean;
}

// Single walk per file: complexity is computed once and feeds both the
// hotspot list and the hard cap.
export function collectFunctionMetrics(
  sf: SourceFile,
  roots: readonly RepoRoot[] = resolveRepoRoots(),
): FunctionMetric[] {
  const file = relFromRepoRoot(sf.getFilePath(), roots);
  const metrics: FunctionMetric[] = [];
  for (const kind of FUNCTION_KINDS) {
    for (const fn of sf.getDescendantsOfKind(kind)) {
      const complexity = computeComplexity(fn);
      if (complexity < COMPLEXITY_THRESHOLD) continue;
      metrics.push({
        file,
        line: fn.getStartLineNumber(),
        name: functionName(fn),
        complexity,
        budgetTagged: hasBudgetTag(fn),
      });
    }
  }
  return metrics;
}

export function hotspotsOf(metrics: readonly FunctionMetric[]): Hotspot[] {
  return metrics
    .filter((m) => !m.budgetTagged)
    .map(({ file, line, name, complexity }) => ({ file, line, name, complexity }));
}

export function capBreachesOf(metrics: readonly FunctionMetric[]): FunctionMetric[] {
  return metrics.filter((m) => m.complexity > HARD_COMPLEXITY_CAP && isLocalFinding(m));
}

export function collectHotspots(
  sf: SourceFile,
  roots: readonly RepoRoot[] = resolveRepoRoots(),
): Hotspot[] {
  return hotspotsOf(collectFunctionMetrics(sf, roots));
}

const BASELINE_FILE = ".kumiko-complexity-baseline.json";

const BASELINE_FORMAT_VERSION = 1;

// The baseline lives inside one repo and may only gate that repo's own files.
// The guard scans every root, so sibling hits appear as "../<repo>/..." relative
// to ROOT: freezing those would fail a money-horse refactor locally in the
// framework (invisible in CI, where no sibling is checked out), and would leak
// private repo paths into the public framework history. The report still lists
// every hotspot — only the baseline view is repo-local.
export function localHotspots(hotspots: readonly Hotspot[]): readonly Hotspot[] {
  return hotspots.filter(isLocalFinding);
}

export function countHotspotsByFile(hotspots: readonly Hotspot[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const h of hotspots) counts[h.file] = (counts[h.file] ?? 0) + 1;
  return counts;
}

function scan(
  files: readonly SourceFile[],
  roots: readonly RepoRoot[] = resolveRepoRoots(),
): {
  hotspots: Hotspot[];
  capBreaches: FunctionMetric[];
  scanned: number;
} {
  const metrics: FunctionMetric[] = [];
  let scanned = 0;
  for (const sf of files) {
    if (EXCLUDE.test(sf.getFilePath())) continue;
    scanned++;
    metrics.push(...collectFunctionMetrics(sf, roots));
  }
  const hotspots = hotspotsOf(metrics).sort((a, b) => b.complexity - a.complexity);
  const capBreaches = capBreachesOf(metrics).sort((a, b) => b.complexity - a.complexity);
  return { hotspots, capBreaches, scanned };
}

function report(
  hotspots: readonly Hotspot[],
  scanned: number,
  capBreaches: readonly FunctionMetric[],
  reportLimit: number,
): void {
  console.log(`Complexity Check: ${scanned} files checked.`);
  console.log(`  Hotspots (complexity >= ${COMPLEXITY_THRESHOLD}): ${hotspots.length}`);
  console.log(`  Above hard cap (complexity > ${HARD_COMPLEXITY_CAP}): ${capBreaches.length}`);
  for (const b of capBreaches) {
    console.log(`    CAP ${b.file}:${b.line}  ${b.name}()  complexity=${b.complexity}`);
  }
  if (hotspots.length === 0) {
    console.log("  Nothing to report.");
  } else {
    const shown = hotspots.slice(0, reportLimit);
    for (const h of shown) {
      console.log(`    ${h.file}:${h.line}  ${h.name}()  complexity=${h.complexity}`);
    }
    if (hotspots.length > shown.length) {
      console.log(`    ... ${hotspots.length - shown.length} more`);
    }
    console.log(
      `\n  Rule: split the function, or deliberately allow it with "// ${BUDGET_TAG} <reason>".`,
    );
  }
}

type Ratchet = ReturnType<typeof baselineRatchet>;

const complexityBaseline = baselineRatchet({
  file: path.join(ROOT, BASELINE_FILE),
  formatVersion: BASELINE_FORMAT_VERSION,
  unit: "Complexity-Hotspot(s)",
});

function capViolations(capBreaches: readonly FunctionMetric[]): GuardViolation[] {
  return capBreaches.map((b) => ({
    file: b.file,
    line: b.line,
    neverFrozen: true,
    message:
      `${b.name}() has complexity ${b.complexity}, above the hard cap of ${HARD_COMPLEXITY_CAP}. ` +
      `A "${BUDGET_TAG}" tag and the baseline do not apply above the cap — split the function.`,
  }));
}

// `scan` sorts by complexity descending, so the first hit for a file is its
// worst function — the one the violation should point at, not whichever
// hotspot happens to come first in the file.
export function resolveHotspotLine(hotspots: readonly Hotspot[], file: string): number {
  return hotspots.find((h) => h.file === file)?.line ?? 1;
}

function checkBaseline(scanned: readonly Hotspot[], ratchet: Ratchet): GuardViolation[] {
  const hotspots = localHotspots(scanned);
  return ratchet.check(
    countHotspotsByFile(hotspots),
    `Split the function, or allow it with "// ${BUDGET_TAG} <reason>".`,
    {
      formatDriftRemediation: `Run \`kumiko-guards guards --write-baseline --guard="Complexity Check"\` once.`,
      resolveLine: (file) => resolveHotspotLine(hotspots, file),
    },
  );
}

export function analyse(
  files: readonly SourceFile[],
  roots: readonly RepoRoot[],
  compareBaseline: boolean,
  options: { ratchet?: Ratchet; reportLimit?: number } = {},
): GuardOutcome {
  const { ratchet = complexityBaseline, reportLimit = MAX_REPORTED } = options;
  const { hotspots, capBreaches, scanned } = scan(files, roots);
  report(hotspots, scanned, capBreaches, reportLimit);
  const hardViolations = capViolations(capBreaches);
  if (!compareBaseline) {
    console.log("  Baseline comparison skipped (--no-baseline).");
    return { violations: hardViolations };
  }
  return { violations: [...hardViolations, ...checkBaseline(hotspots, ratchet)] };
}

export const guard: AstGuard = {
  name: "Complexity Check",
  scan: SCAN,
  // No remediation text here: reportResults appends the hint to EVERY failure,
  // including format drift, where "split the function" would mislead. The
  // concrete advice lives in the respective violation message.
  hint: 'after a deliberate change: `kumiko-guards guards --write-baseline --guard="Complexity Check"`',
  run: (files, roots = resolveRepoRoots()) => analyse(files, roots, true),
  writeBaseline: (files) => {
    const { hotspots, capBreaches, scanned } = scan(files);
    report(hotspots, scanned, capBreaches, MAX_REPORTED);
    complexityBaseline.write(countHotspotsByFile(localHotspots(hotspots)));
  },
};

// Flags are read ONLY here, not in run() — the shared runner (run-guards.ts)
// drives 18 guards with the same argv, and a --write-baseline there must not
// silently rewrite the baseline.
if (import.meta.main) {
  const args = process.argv.slice(2);
  const reportLimit = args.includes("--all") ? Number.POSITIVE_INFINITY : MAX_REPORTED;
  if (args.includes("--write-baseline")) {
    const project = buildSharedProject([guard]);
    const { hotspots, capBreaches, scanned } = scan(filesForGuard(project, guard));
    report(hotspots, scanned, capBreaches, reportLimit);
    complexityBaseline.write(countHotspotsByFile(localHotspots(hotspots)));
    process.exit(0);
  }
  if (args.includes("--no-baseline")) {
    const project = buildSharedProject([guard]);
    const { violations } = analyse(filesForGuard(project, guard), resolveRepoRoots(), false, {
      reportLimit,
    });
    process.exit(violations.length > 0 ? 1 : 0);
  }
  runStandalone({
    ...guard,
    run: (files, roots = resolveRepoRoots()) => analyse(files, roots, true, { reportLimit }),
  });
}

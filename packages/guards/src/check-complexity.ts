#!/usr/bin/env bun
/**
 * Complexity-Check fuer Handler-Hotspots mit Baseline-Regression-Guard.
 *
 * Berechnet zyklomatische Komplexitaet pro Funktion/Methode (Basis 1, +1 je
 * Entscheidungspunkt: if, for, while, case, catch, &&, ||, ??, Ternary).
 * Ueber dem Schwellwert -> Hotspot.
 *
 * Baseline-Regression-Guard wie guard-comment-lang.ts: `.kumiko-complexity-
 * baseline.json` im Repo-Root pinnt pro File die eingefrorene Hotspot-Anzahl.
 *   - aktuell <= baseline pro File: PASS
 *   - aktuell >  baseline pro File: FAIL
 * Reduktionen updaten die Baseline NICHT automatisch — nach Refactor-Commits
 * `--write-baseline` aufrufen. Ohne Baseline-Datei bleibt der Check
 * warning-only (Bootstrap: einmalig `--write-baseline`).
 * Die Baseline umfasst nur Files des eigenen Repos; Sibling-Hotspots gehoeren
 * in deren eigene Baseline (siehe localHotspots).
 *
 * Bewusste Luecke: gezaehlt werden Hotspots pro File, nicht deren Hoehe — eine
 * bereits gelistete Funktion darf komplexer werden, ohne dass der Guard faellt.
 *
 * Opt-out: `// kumiko-lint-ignore complexity-budget <Grund>` auf der
 * Funktionszeile, der Zeile darueber, oder (bei JSDoc-dokumentierten
 * Funktionen) der Zeile ueber dem JSDoc-Block.
 *
 * Usage:
 *   bun guards/check-complexity.ts                  # Vergleich gegen Baseline
 *   bun guards/check-complexity.ts --write-baseline # Baseline neu schreiben
 *   bun guards/check-complexity.ts --no-baseline    # Vergleich ueberspringen
 *
 * Regel: Issue kumiko-framework#1282
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
import { hasIgnoreTag } from "./_lib/ignore-tag";
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
  return (lines[jsDocStartLine - 2] ?? "").includes(BUDGET_TAG);
}

export function computeComplexity(fn: Node): number {
  let complexity = 1;
  fn.forEachDescendant((node, traversal) => {
    // Don't count decision points inside a nested function-like node —
    // those get their own Hotspot entry.
    if (node !== fn && (FUNCTION_KINDS as readonly SyntaxKind[]).includes(node.getKind())) {
      traversal.skip();
      return;
    }
    switch (node.getKind()) {
      case SyntaxKind.IfStatement:
      case SyntaxKind.ForStatement:
      case SyntaxKind.ForInStatement:
      case SyntaxKind.ForOfStatement:
      case SyntaxKind.WhileStatement:
      case SyntaxKind.DoStatement:
      case SyntaxKind.CatchClause:
      case SyntaxKind.ConditionalExpression:
        complexity++;
        break;
      case SyntaxKind.CaseClause:
        complexity++;
        break;
      case SyntaxKind.BinaryExpression: {
        const op = node.asKindOrThrow(SyntaxKind.BinaryExpression).getOperatorToken().getKind();
        if (
          op === SyntaxKind.AmpersandAmpersandToken ||
          op === SyntaxKind.BarBarToken ||
          op === SyntaxKind.QuestionQuestionToken
        ) {
          complexity++;
        }
        break;
      }
      default:
        break;
    }
  });
  return complexity;
}

export function collectHotspots(
  sf: SourceFile,
  roots: readonly RepoRoot[] = resolveRepoRoots(),
): Hotspot[] {
  const file = relFromRepoRoot(sf.getFilePath(), roots);
  const hotspots: Hotspot[] = [];
  for (const kind of FUNCTION_KINDS) {
    for (const fn of sf.getDescendantsOfKind(kind)) {
      const complexity = computeComplexity(fn);
      if (complexity < COMPLEXITY_THRESHOLD) continue;
      if (hasBudgetTag(fn)) continue;
      hotspots.push({
        file,
        line: fn.getStartLineNumber(),
        name: functionName(fn),
        complexity,
      });
    }
  }
  return hotspots;
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
  scanned: number;
} {
  const hotspots: Hotspot[] = [];
  let scanned = 0;
  for (const sf of files) {
    if (EXCLUDE.test(sf.getFilePath())) continue;
    scanned++;
    hotspots.push(...collectHotspots(sf, roots));
  }
  hotspots.sort((a, b) => b.complexity - a.complexity);
  return { hotspots, scanned };
}

function report(hotspots: readonly Hotspot[], scanned: number): void {
  console.log(`Complexity Check: ${scanned} files checked.`);
  console.log(`  Hotspots (complexity >= ${COMPLEXITY_THRESHOLD}): ${hotspots.length}`);
  if (hotspots.length === 0) {
    console.log("  Nothing to report.");
    return;
  }
  const shown = hotspots.slice(0, MAX_REPORTED);
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

const complexityBaseline = baselineRatchet({
  file: path.join(ROOT, BASELINE_FILE),
  formatVersion: BASELINE_FORMAT_VERSION,
  unit: "Complexity-Hotspot(s)",
});

// `scan` sorts by complexity descending, so the first hit for a file is its
// worst function — the one the violation should point at, not whichever
// hotspot happens to come first in the file.
export function resolveHotspotLine(hotspots: readonly Hotspot[], file: string): number {
  return hotspots.find((h) => h.file === file)?.line ?? 1;
}

function checkBaseline(scanned: readonly Hotspot[]): GuardViolation[] {
  const hotspots = localHotspots(scanned);
  return complexityBaseline.check(
    countHotspotsByFile(hotspots),
    `Split the function, or allow it with "// ${BUDGET_TAG} <reason>".`,
    {
      formatDriftRemediation: `Run \`kumiko-guards guards --write-baseline --guard="Complexity Check"\` once.`,
      resolveLine: (file) => resolveHotspotLine(hotspots, file),
    },
  );
}

function analyse(
  files: readonly SourceFile[],
  roots: readonly RepoRoot[],
  compareBaseline: boolean,
): GuardOutcome {
  const { hotspots, scanned } = scan(files, roots);
  report(hotspots, scanned);
  if (!compareBaseline) {
    console.log("  Baseline comparison skipped (--no-baseline).");
    return { violations: [] };
  }
  return { violations: checkBaseline(hotspots) };
}

export const guard: AstGuard = {
  name: "Complexity Check",
  scan: SCAN,
  // Kein Remediation-Text hier: reportResults haengt hint an JEDEN Fail, auch
  // an Format-Drift, wo "Funktion aufteilen" in die Irre fuehrt. Der konkrete
  // Rat steht deshalb in der jeweiligen Violation-Message.
  hint: 'after a deliberate change: `kumiko-guards guards --write-baseline --guard="Complexity Check"`',
  run: (files, roots = resolveRepoRoots()) => analyse(files, roots, true),
  writeBaseline: (files) => {
    const { hotspots, scanned } = scan(files);
    report(hotspots, scanned);
    complexityBaseline.write(countHotspotsByFile(localHotspots(hotspots)));
  },
};

// Flags werden NUR hier gelesen, nicht in run() — der Shared-Runner
// (run-guards.ts) faehrt 18 Guards mit derselben argv, ein --write-baseline
// dort duerfte die Baseline nicht stillschweigend neu schreiben.
if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--write-baseline")) {
    const project = buildSharedProject([guard]);
    const { hotspots, scanned } = scan(filesForGuard(project, guard));
    report(hotspots, scanned);
    complexityBaseline.write(countHotspotsByFile(localHotspots(hotspots)));
    process.exit(0);
  }
  if (args.includes("--no-baseline")) {
    const project = buildSharedProject([guard]);
    analyse(filesForGuard(project, guard), resolveRepoRoots(), false);
    process.exit(0);
  }
  runStandalone(guard);
}

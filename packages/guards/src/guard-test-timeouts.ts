#!/usr/bin/env bun
/**
 * Guard: tests wait for a condition, not for time. Flags, in test files and
 * Playwright specs/helpers:
 *   (a) `test.setTimeout(...)`, `test.slow(...)` — raising a timeout hides the
 *       cause of a slow or flaky test
 *   (b) `<page>.waitForTimeout(...)` — a fixed sleep instead of a condition
 *   (c) sleep loops — a `while`/`do`/`for`/`for…of`/`for…in` whose body calls
 *       `sleep(...)`/`Bun.sleep(...)` or awaits a `new Promise` that only
 *       runs `setTimeout` (hand-rolled polling; use `waitFor`/`expect.poll`)
 * A single `sleep()`/`setTimeout` outside a loop, and a sleeping loop that
 * `yield`s (slow-producer generator), are work simulation and never flagged.
 *
 * Opt-out on the finding's own line or the line above (loop statement for
 * (c)): `// @timeout-exception: #<issue> <technical reason>`. A marker
 * without an issue number or a reason does not count and is called out in
 * the message.
 *
 * `samples/recipes/**` is not touched. `.kumiko-test-timeouts-baseline.json`
 * in the repo root pins the frozen count per file (transition ratchet); over
 * baseline fails, at or under passes. Without the file the guard is
 * warning-only (bootstrap: `--write-baseline` once).
 *
 * Usage:
 *   bun guards/guard-test-timeouts.ts                  # compare to baseline
 *   bun guards/guard-test-timeouts.ts --write-baseline # freeze current
 *   bun guards/guard-test-timeouts.ts --no-baseline    # skip comparison
 */
import * as path from "node:path";
import { type CallExpression, Node, type SourceFile, SyntaxKind } from "ts-morph";
import {
  type AstGuard,
  baselineRatchet,
  buildSharedProject,
  filesForGuard,
  type GuardOutcome,
  type GuardViolation,
  isLocalFinding,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";

const ROOT = process.cwd();

// Playwright dirs sit outside every manifest's sourceRoots/testGlobs, and
// scenario helpers next to the specs (not just *.spec.ts) carry the timeouts too.
const SCAN: ScanSpec = {
  scope: "tests",
  extensions: ["ts", "tsx"],
  extraGlobs: [
    "e2e/**/*.{ts,tsx}",
    "packages/*/e2e/**/*.{ts,tsx}",
    "samples/e2e/**/*.{ts,tsx}",
    "samples/apps/*/e2e/**/*.{ts,tsx}",
  ],
};

const EXCEPTION_TAG = "@timeout-exception";
const COMPLETE_EXCEPTION = /@timeout-exception:\s*#\d+\s+\S/;
const RECIPES_DIR = "/samples/recipes/";

const LOOP_LABELS: ReadonlyMap<SyntaxKind, string> = new Map([
  [SyntaxKind.WhileStatement, "while"],
  [SyntaxKind.DoStatement, "do…while"],
  [SyntaxKind.ForStatement, "for"],
  [SyntaxKind.ForOfStatement, "for…of"],
  [SyntaxKind.ForInStatement, "for…in"],
]);

const SLEEP_CALLEES: ReadonlySet<string> = new Set(["sleep", "Bun.sleep"]);
const TIMEOUT_RAISING_CALLEES: ReadonlySet<string> = new Set(["test.setTimeout", "test.slow"]);
const SET_TIMEOUT_CALLEE = /(^|\.)setTimeout$/;

export interface Finding {
  file: string;
  line: number;
  message: string;
}

function relFile(sf: SourceFile): string {
  return path.relative(ROOT, sf.getFilePath());
}

function isLoop(node: Node): boolean {
  return LOOP_LABELS.has(node.getKind());
}

function callsSetTimeout(node: Node): boolean {
  return node
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .some((call) => SET_TIMEOUT_CALLEE.test(call.getExpression().getText()));
}

function isSleepStatement(node: Node): boolean {
  if (Node.isCallExpression(node)) return SLEEP_CALLEES.has(node.getExpression().getText());
  if (Node.isNewExpression(node) && node.getExpression().getText() === "Promise") {
    const executor = node.getArguments()[0];
    return executor !== undefined && callsSetTimeout(executor);
  }
  return false;
}

// Nested loops are their own finding — skipping them keeps one sleep from
// being counted once per enclosing loop.
function bodySleeps(loop: Node): boolean {
  let found = false;
  loop.forEachDescendant((node, traversal) => {
    if (isLoop(node)) {
      traversal.skip();
      return;
    }
    if (isSleepStatement(node)) {
      found = true;
      traversal.stop();
    }
  });
  return found;
}

// A sleeping loop that yields is a slow-producer simulation, not polling.
function yieldsInBody(loop: Node): boolean {
  return loop.getDescendantsOfKind(SyntaxKind.YieldExpression).length > 0;
}

function exceptionNote(node: Node): "allowed" | "incomplete" | "none" {
  const lines = node.getSourceFile().getFullText().split("\n");
  const line = node.getStartLineNumber();
  const nearby = [lines[line - 1] ?? "", lines[line - 2] ?? ""];
  if (nearby.some((text) => COMPLETE_EXCEPTION.test(text))) return "allowed";
  return nearby.some((text) => text.includes(EXCEPTION_TAG)) ? "incomplete" : "none";
}

function raisedTimeoutReason(call: CallExpression): string | undefined {
  const callee = call.getExpression();
  const calleeText = callee.getText();
  if (TIMEOUT_RAISING_CALLEES.has(calleeText)) {
    return `${calleeText}(…) raises the timeout instead of fixing the cause`;
  }
  if (Node.isPropertyAccessExpression(callee) && callee.getName() === "waitForTimeout") {
    return `${calleeText}(…) waits for time, not for a condition`;
  }
  return undefined;
}

function withExceptionNote(node: Node, message: string): string | undefined {
  const note = exceptionNote(node);
  if (note === "allowed") return undefined;
  return note === "incomplete"
    ? `${message} [incomplete ${EXCEPTION_TAG} marker: needs "#<issue> <technical reason>"]`
    : message;
}

export function scanTimeouts(sf: SourceFile): Finding[] {
  if (sf.getFilePath().includes(RECIPES_DIR)) return [];
  const file = relFile(sf);
  const findings: Finding[] = [];
  const add = (node: Node, message: string): void => {
    const reported = withExceptionNote(node, message);
    if (reported === undefined) return;
    findings.push({ file, line: node.getStartLineNumber(), message: reported });
  };
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const reason = raisedTimeoutReason(call);
    if (reason !== undefined) add(call, reason);
  }
  for (const [kind, label] of LOOP_LABELS) {
    for (const loop of sf.getDescendantsOfKind(kind)) {
      if (bodySleeps(loop) && !yieldsInBody(loop)) {
        add(loop, `${label} loop polls with sleep — wait for a condition, not for time`);
      }
    }
  }
  return findings.sort((a, b) => a.line - b.line);
}

const BASELINE_FILE = ".kumiko-test-timeouts-baseline.json";
const timeoutsBaseline = baselineRatchet({
  file: path.join(ROOT, BASELINE_FILE),
  formatVersion: 1,
  unit: "test timeout workaround(s)",
});

const REMEDIATION = `Wait for a condition (\`waitFor\`, \`expect.poll\`) instead of raising timeouts or sleeping, or mark the line with \`// ${EXCEPTION_TAG}: #<issue> <technical reason>\`.`;

const HINT =
  "Diagnose in this order: (1) reproduce a single run (`--repeat-each`, single file), (2) check shared state and missing isolation (one tenant per flow), (3) wait for a condition, not for time (`waitFor`, `expect.poll`), (4) check the seed, (5) only then change the central template via an issue — never per app. See docs/guides/test-failures.md. After a deliberate change: `bun guards/guard-test-timeouts.ts --write-baseline`.";

export function baselineCounts(findings: readonly Finding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const finding of findings.filter(isLocalFinding)) {
    counts[finding.file] = (counts[finding.file] ?? 0) + 1;
  }
  return counts;
}

function scan(files: readonly SourceFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const sf of files) {
    for (const finding of scanTimeouts(sf)) {
      findings.push(finding);
      console.warn(`  [test-timeouts WARN] ${finding.file}:${finding.line}  ${finding.message}`);
    }
  }
  return findings;
}

function analyse(files: readonly SourceFile[], compareBaseline: boolean): GuardOutcome {
  const findings = scan(files);
  if (!compareBaseline) {
    console.log("  Baseline comparison skipped (--no-baseline).");
    return { violations: [] };
  }
  const local = findings.filter(isLocalFinding);
  const violations: GuardViolation[] = timeoutsBaseline.check(
    baselineCounts(findings),
    REMEDIATION,
    {
      formatDriftRemediation: "Run `bun guards/guard-test-timeouts.ts --write-baseline` once.",
      resolveLine: (file) => local.find((f) => f.file === file)?.line ?? 1,
    },
  );
  return { violations };
}

export const guard: AstGuard = {
  name: "test-timeouts",
  scan: SCAN,
  hint: HINT,
  run: (files) => analyse(files, true),
};

// Flags are read only here, never in run() — the shared runner drives every
// guard with the same argv, and a --write-baseline meant for another guard
// must not silently refreeze this one.
if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--write-baseline")) {
    const project = buildSharedProject([guard]);
    timeoutsBaseline.write(baselineCounts(scan(filesForGuard(project, guard))));
    process.exit(0);
  }
  if (args.includes("--no-baseline")) {
    const project = buildSharedProject([guard]);
    analyse(filesForGuard(project, guard), false);
    process.exit(0);
  }
  runStandalone(guard);
}

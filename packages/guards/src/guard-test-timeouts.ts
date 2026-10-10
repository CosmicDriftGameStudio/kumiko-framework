#!/usr/bin/env bun
/**
 * Guard: tests wait for a condition, not for time. Flags, in test files and
 * Playwright specs/helpers:
 *   (a) `test.setTimeout(...)`, `test.slow(...)`, `setDefaultTimeout(...)`,
 *       `*.describe.configure({ timeout })`, and a timeout argument on
 *       `test`/`it`/`describe` calls (`test(name, fn, 30_000)`,
 *       `test(name, fn, { timeout })`, also via `.skip/.only/.if()/.each()()`
 *       and renamed/namespace `bun:test` imports) — raising a timeout hides
 *       the cause of a slow or flaky test
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
 * `samples/recipes/**` is not touched. No baseline, no ratchet: any finding
 * fails. #3118's transition period (a `.kumiko-test-timeouts-baseline.json`
 * grandfathering pre-existing sleep loops) is over — every consumer must fix
 * or mark the cause, not accumulate a pinned count.
 *
 * Usage (framework dev checkout):
 *   bun guards/guard-test-timeouts.ts
 * Consumer (via the published `kumiko-guards` CLI):
 *   kumiko-guards guards --guard=test-timeouts
 */
import { type CallExpression, Node, type SourceFile, SyntaxKind } from "ts-morph";
import {
  type AstGuard,
  type GuardOutcome,
  type GuardViolation,
  isLocalFinding,
  relFromRepoRoot,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";
import { type RepoRoot, resolveRepoRoots } from "./_lib/roots";

// Playwright dirs sit outside every manifest's sourceRoots/testGlobs, and
// scenario helpers next to the specs (not just *.spec.ts) carry the timeouts too.
const SCAN: ScanSpec = {
  scope: "tests",
  extensions: ["ts", "tsx"],
  extraGlobs: [
    "e2e/**/*.{ts,tsx}",
    "packages/*/e2e/**/*.{ts,tsx}",
    "packages/*/src/e2e/**/*.{ts,tsx}",
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
const SET_DEFAULT_TIMEOUT_CALLEE = /(^|\.)setDefaultTimeout$/;
const DESCRIBE_CONFIGURE_CALLEE = /(^|\.)describe\.configure$/;
const TEST_FRAMEWORK_MODULES: ReadonlySet<string> = new Set(["bun:test", "@playwright/test"]);
const TEST_DECLARATION_CALLEE =
  /^(test|it|describe)(\.(skip|only|todo|if|each|failing|concurrent|serial|skipIf|runIf|todoIf))*$/;

export interface Finding {
  file: string;
  line: number;
  message: string;
}

function relFile(sf: SourceFile, roots: readonly RepoRoot[]): string {
  return relFromRepoRoot(sf.getFilePath(), roots);
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

function bodySleeps(loop: Node): boolean {
  let found = false;
  loop.forEachDescendant((node, traversal) => {
    // skip: nested loops are their own finding, so one sleep is not counted
    // once per enclosing loop
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

function hasTimeoutProperty(node: Node | undefined): boolean {
  return (
    node !== undefined &&
    Node.isObjectLiteralExpression(node) &&
    node.getProperties().some((prop) => {
      if (Node.isShorthandPropertyAssignment(prop) || Node.isPropertyAssignment(prop)) {
        return prop.getName() === "timeout";
      }
      return false;
    })
  );
}

// Maps local names imported from the test framework to their exported name;
// "" marks a namespace import (`import * as bt`), whose member access is stripped.
function testFrameworkAliases(sf: SourceFile): ReadonlyMap<string, string> {
  const aliases = new Map<string, string>();
  for (const decl of sf.getImportDeclarations()) {
    if (!TEST_FRAMEWORK_MODULES.has(decl.getModuleSpecifierValue())) continue;
    const namespaceImport = decl.getNamespaceImport();
    if (namespaceImport !== undefined) aliases.set(namespaceImport.getText(), "");
    for (const named of decl.getNamedImports()) {
      const alias = named.getAliasNode();
      if (alias !== undefined) aliases.set(alias.getText(), named.getName());
    }
  }
  return aliases;
}

function canonicalCalleeText(text: string, aliases: ReadonlyMap<string, string>): string {
  const [head = "", ...rest] = text.split(".");
  const imported = aliases.get(head);
  if (imported === undefined) return text;
  return (imported === "" ? rest : [imported, ...rest]).join(".");
}

// `test.each(rows)(…)` and `test.if(cond)(…)` call the result of a call.
function declarationBaseCallee(callee: Node): Node {
  return Node.isCallExpression(callee) ? declarationBaseCallee(callee.getExpression()) : callee;
}

function isTimeoutArgument(arg: Node): boolean {
  if (Node.isObjectLiteralExpression(arg)) return hasTimeoutProperty(arg);
  return !Node.isArrowFunction(arg) && !Node.isFunctionExpression(arg);
}

function declarationTimeoutReason(
  call: CallExpression,
  aliases: ReadonlyMap<string, string>,
): string | undefined {
  const base = canonicalCalleeText(declarationBaseCallee(call.getExpression()).getText(), aliases);
  if (!TEST_DECLARATION_CALLEE.test(base)) return undefined;
  const [, , ...extra] = call.getArguments();
  if (!extra.some(isTimeoutArgument)) return undefined;
  return `${base}(…, timeout) raises the timeout instead of fixing the cause`;
}

function raisedTimeoutReason(
  call: CallExpression,
  aliases: ReadonlyMap<string, string>,
): string | undefined {
  const callee = call.getExpression();
  const calleeText = canonicalCalleeText(callee.getText(), aliases);
  const declarationReason = declarationTimeoutReason(call, aliases);
  if (declarationReason !== undefined) return declarationReason;
  if (TIMEOUT_RAISING_CALLEES.has(calleeText) || SET_DEFAULT_TIMEOUT_CALLEE.test(calleeText)) {
    return `${calleeText}(…) raises the timeout instead of fixing the cause`;
  }
  if (DESCRIBE_CONFIGURE_CALLEE.test(calleeText) && call.getArguments().some(hasTimeoutProperty)) {
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

export function scanTimeouts(
  sf: SourceFile,
  roots: readonly RepoRoot[] = resolveRepoRoots(),
): Finding[] {
  if (sf.getFilePath().includes(RECIPES_DIR)) return [];
  const file = relFile(sf, roots);
  const findings: Finding[] = [];
  const add = (node: Node, message: string): void => {
    const reported = withExceptionNote(node, message);
    if (reported !== undefined) {
      findings.push({ file, line: node.getStartLineNumber(), message: reported });
    }
  };
  const aliases = testFrameworkAliases(sf);
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const reason = raisedTimeoutReason(call, aliases);
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

const REMEDIATION = `Wait for a condition (\`waitFor\`, \`expect.poll\`) instead of raising timeouts or sleeping, or mark the line with \`// ${EXCEPTION_TAG}: #<issue> <technical reason>\`.`;

const HINT =
  "Diagnose in this order: (1) reproduce a single run (`--repeat-each`, single file), (2) check shared state and missing isolation (one tenant per flow), (3) wait for a condition, not for time (`waitFor`, `expect.poll`), (4) check the seed, (5) only then change the central template via an issue — never per app. See https://github.com/CosmicDriftGameStudio/kumiko-framework/blob/main/docs/guides/test-failures.md.";

function analyse(files: readonly SourceFile[], roots: readonly RepoRoot[]): GuardOutcome {
  const findings: Finding[] = [];
  for (const sf of files) {
    for (const finding of scanTimeouts(sf, roots)) {
      findings.push(finding);
      console.warn(`  [test-timeouts WARN] ${finding.file}:${finding.line}  ${finding.message}`);
    }
  }
  const violations: GuardViolation[] = findings
    .filter(isLocalFinding)
    .map((f) => ({ file: f.file, line: f.line, message: `${f.message} ${REMEDIATION}` }));
  return { violations };
}

export const guard: AstGuard = {
  name: "test-timeouts",
  scan: SCAN,
  hint: HINT,
  run: (files, roots = resolveRepoRoots()) => analyse(files, roots),
};

if (import.meta.main) runStandalone(guard);

#!/usr/bin/env bun
/**
 * Guard: tests must actually assert something. Flags:
 *   (a) Always-true assertions: expect(true).toBe(true), expect(1).toBe(1)
 *   (b) Test bodies with zero expect() calls
 *
 * Both are silent failures — they count as "passing" but prove nothing. In
 * integration tests this is particularly toxic, since the whole point is to
 * prove wiring against the real stack.
 *
 * Usage:
 *   bun guards/guard-fake-tests.ts
 */

import * as path from "node:path";
import { type CallExpression, type Node, type SourceFile, SyntaxKind } from "ts-morph";
import { type AstGuard, runStandalone, type ScanSpec } from "./_lib/guard-kit";

const ROOT = process.cwd();

const SCAN: ScanSpec = {
  scope: "tests",
  extensions: ["ts", "tsx"],
  kinds: ["framework", "library", "app"],
};

interface Violation {
  file: string;
  line: number;
  kind: "tautology" | "no-expect";
  detail: string;
}

const TAUTOLOGIES = [
  /^expect\(\s*true\s*\)\.toBe\(\s*true\s*\)$/,
  /^expect\(\s*false\s*\)\.toBe\(\s*false\s*\)$/,
  /^expect\(\s*1\s*\)\.toBe\(\s*1\s*\)$/,
  /^expect\(\s*['"]\w+['"]\s*\)\.toBe\(\s*['"]\w+['"]\s*\)$/,
];

function isTestCall(call: CallExpression): boolean {
  const expr = call.getExpression();
  const text = expr.getText();
  return text === "it" || text === "test";
}

// Helpers that internally call `expect(...)` and assert something —
// treating a call to one of these as equivalent to a direct `expect()` in
// the body. Extend this list only when a new wrapper provides a real
// assertion (not a silent-noop alias), otherwise it re-opens the
// "no expect" escape hatch.
const ASSERTION_HELPER_NAMES = new Set([
  "expectError",
  "expectSuccess",
  "expectErrorIncludes",
  // expectTypeOf — Vitest's compile-time type assertion. Failures show up as
  // tsc errors (e.g. TS2344 "Type 'X' does not satisfy ..."), not as runtime
  // expect failures, but they ARE real assertions on the type level.
  "expectTypeOf",
]);

// Matched on the LAST property name of a property-access callee
// (`stack.http.writeOk(...)`, `tenant.api.queryErr(...)`) — these throw on
// the wrong outcome, same as expect(), so a call to one counts as an
// assertion (framework request-helper.ts, testing auth-kit.ts successData).
const ASSERTION_API_METHODS = new Set(["writeOk", "writeErr", "queryOk", "queryErr"]);

const MAX_HELPER_DEPTH = 3;

function isDirectAssertionCall(call: CallExpression): boolean {
  const expr = call.getExpression();
  const text = expr.getText();
  if (text === "expect" || text.startsWith("expect.")) return true;
  if (ASSERTION_HELPER_NAMES.has(text)) return true;
  if (!expr.isKind(SyntaxKind.PropertyAccessExpression)) return false;
  const name = expr.getName();
  return ASSERTION_API_METHODS.has(name);
}

// A bare identifier `foo(...)` counts as an assertion when `foo` is declared
// in the SAME file (function declaration, or a variable initialized with an
// arrow/function expression, at any nesting level) and its own body asserts —
// recursively, so a chain of thin wrappers around expect() still counts.
function resolveSameFileHelper(sf: SourceFile, name: string): Node | undefined {
  const fn = sf
    .getDescendantsOfKind(SyntaxKind.FunctionDeclaration)
    .find((f) => f.getName() === name);
  if (fn) return fn;
  const varDecl = sf
    .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
    .find((v) => v.getName() === name);
  const init = varDecl?.getInitializer();
  if (
    init &&
    (init.isKind(SyntaxKind.ArrowFunction) || init.isKind(SyntaxKind.FunctionExpression))
  ) {
    return init;
  }
  return undefined;
}

// depth limit + visited set: a helper chain deeper than the limit is treated
// as unproven (violation), and a recursive helper never infinite-loops.
function bodyHasAssertion(node: Node, sf: SourceFile, depth: number, visited: Set<Node>): boolean {
  if (visited.has(node)) return false;
  visited.add(node);
  for (const call of node.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (isDirectAssertionCall(call)) return true;
    if (depth >= MAX_HELPER_DEPTH) continue;
    const expr = call.getExpression();
    if (!expr.isKind(SyntaxKind.Identifier)) continue;
    const helper = resolveSameFileHelper(sf, expr.getText());
    if (helper && bodyHasAssertion(helper, sf, depth + 1, visited)) return true;
  }
  return false;
}

function scanFile(sf: SourceFile): Violation[] {
  const violations: Violation[] = [];
  const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression);

  for (const call of calls) {
    // (a) tautology: full expression text matches a known trivial pattern
    const text = call.getText().replace(/\s+/g, " ").trim();
    if (TAUTOLOGIES.some((re) => re.test(text))) {
      violations.push({
        file: path.relative(ROOT, sf.getFilePath()),
        line: call.getStartLineNumber(),
        kind: "tautology",
        detail: text.slice(0, 60),
      });
      continue;
    }

    // (b) no-expect: it/test with empty expect count
    if (!isTestCall(call)) continue;
    const args = call.getArguments();
    if (args.length < 2) continue;
    const body = args[1];
    if (!body) continue;
    const isArrowOrFn =
      body.isKind(SyntaxKind.ArrowFunction) || body.isKind(SyntaxKind.FunctionExpression);
    if (!isArrowOrFn) continue;
    const hasAssertion = bodyHasAssertion(body, sf, 0, new Set());
    if (!hasAssertion) {
      const nameArg = args[0]?.getText().slice(0, 50) ?? "<anonymous>";
      violations.push({
        file: path.relative(ROOT, sf.getFilePath()),
        line: call.getStartLineNumber(),
        kind: "no-expect",
        detail: nameArg,
      });
    }
  }
  return violations;
}

export const guard: AstGuard = {
  name: "Fake-Test Guard",
  scan: SCAN,
  hint: "Test without expect() or with a tautology — check real behavior, not existence.",
  run(files) {
    const violations: Array<{ file: string; line: number; message: string }> = [];
    for (const sf of files) {
      for (const v of scanFile(sf)) {
        const label = v.kind === "tautology" ? "TAUTOLOGY" : "NO EXPECT";
        violations.push({
          file: v.file,
          line: v.line,
          message: `${label}: ${v.detail}`,
        });
      }
    }
    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);

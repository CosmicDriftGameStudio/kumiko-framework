#!/usr/bin/env bun
/**
 * Guard: tests must actually assert something. Flags:
 *   (a) Always-true assertions: expect(true).toBe(true), expect(1).toBe(1),
 *       or a value compared with itself
 *   (b) Test bodies with zero expect() calls
 *   (c) An existence-only check (toBeDefined/toBeTruthy/not.toBeNull/
 *       not.toBeUndefined) on a writeErr/queryErr result, which always
 *       returns an error object
 *
 * All are silent failures — they count as "passing" but prove nothing. In
 * integration tests this is particularly toxic, since the whole point is to
 * prove wiring against the real stack.
 *
 * Usage:
 *   bun guards/guard-fake-tests.ts
 */

import * as path from "node:path";
import { type CallExpression, type Node, type SourceFile, SyntaxKind } from "ts-morph";
import { type AstGuard, runStandalone, type ScanSpec } from "./_lib/guard-kit";
import {
  canonicalCalleeText,
  declarationBaseCallee,
  TEST_CASE_CALLEE,
  testFrameworkAliases,
} from "./_lib/test-callee";

const ROOT = process.cwd();

const SCAN: ScanSpec = {
  scope: "tests",
  extensions: ["ts", "tsx"],
  kinds: ["framework", "library", "app"],
};

interface Violation {
  file: string;
  line: number;
  kind: "tautology" | "no-expect" | "error-existence";
  detail: string;
}

const TAUTOLOGIES = [
  /^expect\(\s*true\s*\)\.toBe\(\s*true\s*\)$/,
  /^expect\(\s*false\s*\)\.toBe\(\s*false\s*\)$/,
  /^expect\(\s*1\s*\)\.toBe\(\s*1\s*\)$/,
  /^expect\(\s*['"]\w+['"]\s*\)\.toBe\(\s*['"]\w+['"]\s*\)$/,
];

function isTestCall(call: CallExpression, aliases: ReadonlyMap<string, string>): boolean {
  return TEST_CASE_CALLEE.test(
    canonicalCalleeText(declarationBaseCallee(call.getExpression()).getText(), aliases),
  );
}

const SELF_COMPARISON_MATCHERS: ReadonlySet<string> = new Set([
  "toBe",
  "toEqual",
  "toStrictEqual",
]);

function withoutWhitespace(text: string): string {
  return text.replace(/\s+/g, "");
}

function containsCallOrNew(node: Node): boolean {
  return (
    node.isKind(SyntaxKind.CallExpression) ||
    node.isKind(SyntaxKind.NewExpression) ||
    node.getFirstDescendantByKind(SyntaxKind.CallExpression) !== undefined ||
    node.getFirstDescendantByKind(SyntaxKind.NewExpression) !== undefined
  );
}

// Calls and `new` are excluded so determinism checks like
// expect(hash(x)).toBe(hash(x)) stay allowed.
function isSelfComparison(call: CallExpression): boolean {
  const matcher = call.getExpression();
  if (!matcher.isKind(SyntaxKind.PropertyAccessExpression)) return false;
  if (!SELF_COMPARISON_MATCHERS.has(matcher.getName())) return false;
  const expectCall = matcher.getExpression();
  if (!expectCall.isKind(SyntaxKind.CallExpression)) return false;
  if (expectCall.getExpression().getText() !== "expect") return false;
  const expectArgs = expectCall.getArguments();
  const matcherArgs = call.getArguments();
  const actual = expectArgs[0];
  const expected = matcherArgs[0];
  if (expectArgs.length !== 1 || matcherArgs.length !== 1) return false;
  if (actual === undefined || expected === undefined) return false;
  if (containsCallOrNew(actual)) return false;
  return withoutWhitespace(actual.getText()) === withoutWhitespace(expected.getText());
}

const ERROR_RESULT_METHODS: ReadonlySet<string> = new Set(["writeErr", "queryErr"]);
const EXISTENCE_ONLY_MATCHERS: ReadonlySet<string> = new Set(["toBeDefined", "toBeTruthy"]);
const NEGATED_EXISTENCE_MATCHERS: ReadonlySet<string> = new Set(["toBeNull", "toBeUndefined"]);
const ERROR_RESULT_FIELDS: ReadonlySet<string> = new Set([
  "code",
  "httpStatus",
  "message",
  "i18nKey",
]);

function isErrorResultCall(node: Node): boolean {
  const inner = node.isKind(SyntaxKind.AwaitExpression) ? node.getExpression() : node;
  if (!inner.isKind(SyntaxKind.CallExpression)) return false;
  const callee = inner.getExpression();
  return (
    callee.isKind(SyntaxKind.PropertyAccessExpression) && ERROR_RESULT_METHODS.has(callee.getName())
  );
}

// Resolved by symbol, never by name, so a same-named variable from another
// scope (e.g. `error` from a queryOk call) is not mistaken for an error result.
function isErrorResultValue(node: Node, sf: SourceFile): boolean {
  if (isErrorResultCall(node)) return true;
  if (node.isKind(SyntaxKind.PropertyAccessExpression)) {
    return ERROR_RESULT_FIELDS.has(node.getName()) && isErrorResultValue(node.getExpression(), sf);
  }
  if (!node.isKind(SyntaxKind.Identifier)) return false;
  return (node.getSymbol()?.getDeclarations() ?? []).some((decl) => {
    if (decl.getSourceFile() !== sf || !decl.isKind(SyntaxKind.VariableDeclaration)) return false;
    const init = decl.getInitializer();
    return init !== undefined && isErrorResultCall(init);
  });
}

function isExpectCall(node: Node): node is CallExpression {
  return node.isKind(SyntaxKind.CallExpression) && node.getExpression().getText() === "expect";
}

// writeErr/queryErr return an error object or throw, so asserting only that
// the result exists can never fail.
function isExistenceOnlyErrorCheck(call: CallExpression, sf: SourceFile): boolean {
  const matcher = call.getExpression();
  if (!matcher.isKind(SyntaxKind.PropertyAccessExpression)) return false;
  const target = matcher.getExpression();
  let expectCall: Node;
  if (EXISTENCE_ONLY_MATCHERS.has(matcher.getName())) {
    expectCall = target;
  } else if (
    NEGATED_EXISTENCE_MATCHERS.has(matcher.getName()) &&
    target.isKind(SyntaxKind.PropertyAccessExpression) &&
    target.getName() === "not"
  ) {
    expectCall = target.getExpression();
  } else {
    return false;
  }
  if (!isExpectCall(expectCall)) return false;
  const args = expectCall.getArguments();
  const actual = args[0];
  return args.length === 1 && actual !== undefined && isErrorResultValue(actual, sf);
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

// A bare identifier `foo(...)` counts as an assertion when `foo` resolves
// (by symbol, so a same-named helper in another scope is not confused with it)
// to a declaration in the SAME file (function declaration, or a variable
// initialized with an arrow/function expression) whose own body asserts —
// recursively, so a chain of thin wrappers around expect() still counts.
function resolveSameFileHelper(sf: SourceFile, identifier: Node): Node | undefined {
  for (const decl of identifier.getSymbol()?.getDeclarations() ?? []) {
    if (decl.getSourceFile() !== sf) continue;
    if (decl.isKind(SyntaxKind.FunctionDeclaration)) return decl;
    if (!decl.isKind(SyntaxKind.VariableDeclaration)) continue;
    const init = decl.getInitializer();
    if (
      init &&
      (init.isKind(SyntaxKind.ArrowFunction) || init.isKind(SyntaxKind.FunctionExpression))
    ) {
      return init;
    }
  }
  return undefined;
}

// depth limit + shallowest-visit memo: a helper chain deeper than the limit is
// treated as unproven (violation), a recursive helper never infinite-loops, and
// a helper first reached at the depth limit is still explored when reached
// again via a shorter path.
function bodyHasAssertion(
  node: Node,
  sf: SourceFile,
  depth: number,
  shallowestVisit: Map<Node, number>,
): boolean {
  const seenAt = shallowestVisit.get(node);
  if (seenAt !== undefined && seenAt <= depth) return false;
  shallowestVisit.set(node, depth);
  for (const call of node.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (isDirectAssertionCall(call)) return true;
    if (depth >= MAX_HELPER_DEPTH) continue;
    const expr = call.getExpression();
    if (!expr.isKind(SyntaxKind.Identifier)) continue;
    const helper = resolveSameFileHelper(sf, expr);
    if (helper && bodyHasAssertion(helper, sf, depth + 1, shallowestVisit)) return true;
  }
  return false;
}

function scanFile(sf: SourceFile): Violation[] {
  const violations: Violation[] = [];
  const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression);
  const aliases = testFrameworkAliases(sf);

  for (const call of calls) {
    // (a) tautology: full expression text matches a known trivial pattern
    const text = call.getText().replace(/\s+/g, " ").trim();
    if (TAUTOLOGIES.some((re) => re.test(text)) || isSelfComparison(call)) {
      violations.push({
        file: path.relative(ROOT, sf.getFilePath()),
        line: call.getStartLineNumber(),
        kind: "tautology",
        detail: text.slice(0, 60),
      });
      continue;
    }

    // (c) existence-only check on a writeErr/queryErr result
    if (isExistenceOnlyErrorCheck(call, sf)) {
      violations.push({
        file: path.relative(ROOT, sf.getFilePath()),
        line: call.getStartLineNumber(),
        kind: "error-existence",
        detail: text.slice(0, 60),
      });
      continue;
    }

    // (b) no-expect: it/test with empty expect count
    if (!isTestCall(call, aliases)) continue;
    const args = call.getArguments();
    if (args.length < 2) continue;
    const body = args[1];
    if (!body) continue;
    const isArrowOrFn =
      body.isKind(SyntaxKind.ArrowFunction) || body.isKind(SyntaxKind.FunctionExpression);
    if (!isArrowOrFn) continue;
    const hasAssertion = bodyHasAssertion(body, sf, 0, new Map());
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

const VIOLATION_LABELS: Record<Violation["kind"], string> = {
  tautology: "TAUTOLOGY",
  "error-existence":
    "ERROR EXISTS ONLY (writeErr/queryErr always return an error; assert its code or details)",
  "no-expect": "NO EXPECT",
};

export const guard: AstGuard = {
  name: "Fake-Test Guard",
  scan: SCAN,
  hint: "Test without expect(), with a tautology, or an existence-only check on a writeErr/queryErr result — check real behavior, not existence.",
  run(files) {
    const violations: Array<{ file: string; line: number; message: string }> = [];
    for (const sf of files) {
      for (const v of scanFile(sf)) {
        violations.push({
          file: v.file,
          line: v.line,
          message: `${VIOLATION_LABELS[v.kind]}: ${v.detail}`,
        });
      }
    }
    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);

#!/usr/bin/env bun
// web/ contains components and hooks — computation, parsing and aggregation
// belong in lib/ (with a test). This guard flags top-level functions in
// web/**/*.tsx that "compute" (control flow, local bindings, or a domain
// call in the return) but are NEITHER a component (JSX return) NOR a hook
// (use*) NOR a type guard (x is T). Pure single-return predicates stay
// allowed (typeof/comparisons without a call).
//
// Motivation: coverage thresholds don't see web/ (lib-only), and that's
// exactly where untested computation logic hides in 400-line screens. This
// guard is the structural counterpart — it makes logic-in-views visible and
// forces extraction into lib/.

import {
  type ArrowFunction,
  type FunctionDeclaration,
  type FunctionExpression,
  Node,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";
import { type AstGuard, type GuardViolation, runStandalone, type ScanSpec } from "./_lib/guard-kit";
import { hasIgnoreTag } from "./_lib/ignore-tag";

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["tsx"],
  within: ["**/web/**"],
  frameworkWithin: ["samples/apps/*/src/**/web/**"],
};
const EXCLUDE = /(__tests__|\.test\.tsx?$|\.integration\.tsx?$|\.d\.ts$)/;
const IGNORE_TAG = "kumiko-lint-ignore no-logic-in-views";

type Callable = FunctionDeclaration | ArrowFunction | FunctionExpression;

function containsJsx(fn: Callable): boolean {
  return (
    fn.getDescendantsOfKind(SyntaxKind.JsxElement).length > 0 ||
    fn.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).length > 0 ||
    fn.getDescendantsOfKind(SyntaxKind.JsxFragment).length > 0
  );
}

function isHookName(name: string): boolean {
  return /^use[A-Z0-9]/.test(name);
}

// React convention: PascalCase = component. In web/ these are render
// functions (including cell renderers that return a formatted string
// instead of a JSX element) — not an extraction candidate. camelCase
// functions are helpers/logic.
function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

// Type guard (x is T) or boolean return → predicate/guard, not an
// extraction candidate. The boolean case covers predicates that use
// primitive methods (d.name.trim().length > 0) without having to
// distinguish method calls from domain calls — the return semantics
// "decision" is the signal.
function isPredicate(fn: Callable): boolean {
  const rt = fn.getReturnTypeNode();
  if (rt?.getKind() === SyntaxKind.TypePredicate) return true;
  if (rt?.getKind() === SyntaxKind.BooleanKeyword) return true;
  // No explicit `: boolean` — check the inferred return type instead,
  // otherwise unannotated predicates with a primitive method in the return
  // (e.g. `function isReady(d) { return d.name.trim().length > 0 }`) fall
  // through and get flagged as view logic incorrectly.
  if (rt === undefined) return fn.getReturnType().isBoolean();
  return false;
}

// A call in the return distinguishes the delegator/computation (summarize →
// summarizeScenario(...)) from the pure predicate (typeof x === "number" && …).
function hasCall(node: Node): boolean {
  return (
    node.getKind() === SyntaxKind.CallExpression ||
    node.getDescendantsOfKind(SyntaxKind.CallExpression).length > 0
  );
}

// Trivial = a single `return <expr>` without a call. Multiple statements,
// local bindings and control flow are per se not a single-return form and
// therefore automatically fall through (→ logic).
function isTrivialPredicate(fn: Callable): boolean {
  const body = fn.getBody();
  if (body === undefined) return true;
  if (Node.isBlock(body)) {
    const stmts = body.getStatements();
    if (stmts.length !== 1) return false;
    const only = stmts[0];
    if (only === undefined || !Node.isReturnStatement(only)) return false;
    const expr = only.getExpression();
    return expr === undefined || !hasCall(expr);
  }
  // Expression-bodied arrow: const isX = (v) => v > 0
  return !hasCall(body);
}

function isViewLogic(name: string, fn: Callable): boolean {
  if (isHookName(name)) return false;
  if (isComponentName(name) || containsJsx(fn)) return false;
  if (isPredicate(fn)) return false;
  return !isTrivialPredicate(fn);
}

function topLevelCallables(sf: SourceFile): { name: string; fn: Callable }[] {
  const out: { name: string; fn: Callable }[] = [];
  for (const fd of sf.getFunctions()) {
    out.push({ name: fd.getName() ?? "", fn: fd });
  }
  for (const vs of sf.getVariableStatements()) {
    for (const decl of vs.getDeclarations()) {
      const init = decl.getInitializer();
      if (init !== undefined && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
        out.push({ name: decl.getName(), fn: init });
      }
    }
  }
  return out;
}

export const guard: AstGuard = {
  name: "No-Logic-in-Views Guard (App-Repos)",
  scan: SCAN,
  hint:
    "Computation/parsing/aggregation belongs in lib/ (with a test) — web/ holds only " +
    `components and hooks. Justified exception: // ${IGNORE_TAG} <reason>`,
  run(files: readonly SourceFile[]) {
    const violations: GuardViolation[] = [];
    for (const sf of files) {
      if (EXCLUDE.test(sf.getFilePath())) continue;
      for (const { name, fn } of topLevelCallables(sf)) {
        if (name === "" || !isViewLogic(name, fn)) continue;
        if (hasIgnoreTag(fn, IGNORE_TAG)) continue;
        violations.push({
          file: sf.getFilePath(),
          line: fn.getStartLineNumber(),
          message: `View logic "${name}" belongs in lib/ (with a test) — web/ only components/hooks`,
        });
      }
    }
    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);

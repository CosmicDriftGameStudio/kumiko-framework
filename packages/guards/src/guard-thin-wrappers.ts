#!/usr/bin/env bun
/**
 * Thin-Wrapper Guard (warning, never fails).
 *
 * Finds functions that only call another function (1 statement, direct
 * delegation) and are not marked as a deliberate wrapper.
 *
 * Such wrappers often appear as compatibility shims after refactorings —
 * this guard keeps the list visible so they can be deliberately removed.
 *
 * === Setting a marker ===
 *
 * When a wrapper is deliberate and permanent, right above the function:
 *
 *   // @wrapper-known semantic-alias
 *   export function signDeletionToken(dek: Buffer): string {
 *     return signToken(dek);
 *   }
 *
 * Known reasons:
 *   semantic-alias   — deliberate rename for domain clarity
 *   error-helper     — named error constructor (delegates to writeFailure or similar)
 *   uuid-domain      — domain-specific UUID generator
 *   test-helper      — test-utility alias
 *   monitoring       — monitoring/metrics alias
 *   health-check     — health-check wrapper
 *   entry-point      — entry-point-specific configuration
 */

import * as path from "node:path";
import {
  type ArrowFunction,
  type FunctionDeclaration,
  type FunctionExpression,
  Project,
  type SourceFile,
  SyntaxKind,
  type VariableDeclaration,
} from "ts-morph";
import { type RepoCheck, reportResults, runRepoChecks } from "./_lib/guard-kit";
import { frameworkTsConfigPath } from "./_lib/roots";
import { type ScanSpec, scanFiles } from "./_lib/scan-scope";

const ROOT = process.cwd();

const EXCLUDE =
  /(__tests__|\.test\.(ts|tsx)$|\.integration\.(ts|tsx)$|\.d\.(ts|tsx)$|\.spec\.(ts|tsx)$|node_modules)/;

// ── Known reasons ─────────────────────────────────────────────────────────

export const KNOWN_WRAPPER_REASONS = [
  "semantic-alias", // deliberate rename for domain clarity
  "error-helper", // named error constructor
  "uuid-domain", // domain-specific UUID generator
  "test-helper", // test-utility alias
  "monitoring", // monitoring/metrics alias
  "health-check", // health-check wrapper
  "entry-point", // entry-point-specific configuration
] as const;

export type WrapperReason = (typeof KNOWN_WRAPPER_REASONS)[number];

function isKnownReason(r: string): r is WrapperReason {
  return (KNOWN_WRAPPER_REASONS as readonly string[]).includes(r);
}

// ── Built-in filter ─────────────────────────────────────────────────────

const BUILTIN_NAMES = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "map",
  "filter",
  "reduce",
  "reduceRight",
  "forEach",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "some",
  "every",
  "includes",
  "indexOf",
  "lastIndexOf",
  "slice",
  "splice",
  "concat",
  "flat",
  "flatMap",
  "join",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
  "at",
  "entries",
  "keys",
  "values",
  "from",
  "isArray",
  "of",
  "assign",
  "create",
  "fromEntries",
  "defineProperty",
  "getOwnPropertyNames",
  "getOwnPropertyDescriptor",
  "hasOwn",
  "freeze",
  "seal",
  "replace",
  "replaceAll",
  "split",
  "trim",
  "trimStart",
  "trimEnd",
  "trimLeft",
  "trimRight",
  "startsWith",
  "endsWith",
  "substring",
  "padStart",
  "padEnd",
  "repeat",
  "match",
  "matchAll",
  "search",
  "charAt",
  "charCodeAt",
  "toUpperCase",
  "toLowerCase",
  "normalize",
  "toString",
  "valueOf",
  "stringify",
  "parse",
  "log",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "table",
  "group",
  "groupEnd",
  "time",
  "timeEnd",
  "min",
  "max",
  "floor",
  "ceil",
  "round",
  "abs",
  "sqrt",
  "pow",
  "random",
  "sign",
  "trunc",
  "then",
  "catch",
  "finally",
  "resolve",
  "reject",
  "all",
  "allSettled",
  "race",
  "any",
  "get",
  "set",
  "has",
  "delete",
  "clear",
  "call",
  "apply",
  "bind",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "String",
  "Number",
  "Boolean",
  "Symbol",
  "BigInt",
  "Array",
  "Object",
  "Promise",
  "Map",
  "Set",
  "send",
  "emit",
  "on",
  "off",
  "once",
  "next",
  "done",
  "throw",
  "return",
]);

// ── Types ─────────────────────────────────────────────────────────────────

type FnNode = FunctionDeclaration | ArrowFunction | FunctionExpression;

export interface Finding {
  file: string;
  line: number;
  fnName: string;
  callee: string;
  markerReason: string | null; // null = no marker, string = reason (unknown reasons included)
}

// ── AST helpers ───────────────────────────────────────────────────────────

function getFnName(node: FnNode): string | undefined {
  if (node.isKind(SyntaxKind.FunctionDeclaration)) return node.getName() ?? undefined;
  const parent = node.getParent();
  if (parent?.isKind(SyntaxKind.VariableDeclaration)) {
    return (parent as VariableDeclaration).getName();
  }
  if (parent?.isKind(SyntaxKind.PropertyAssignment)) {
    return parent.getFirstChild()?.getText();
  }
  // ponytail: MethodDeclaration dropped — getFirstChild() returns the modifier keyword, not the name.
  return undefined;
}

function getSingleDirectCallee(node: FnNode): string | null {
  const rawBody =
    node.isKind(SyntaxKind.ArrowFunction) && !node.getBody().isKind(SyntaxKind.Block)
      ? null
      : node.getBody();

  // Concise arrow: `x => someCall(x)` — body IS the expression
  if (!rawBody || !rawBody.isKind(SyntaxKind.Block)) {
    const body = node.getBody();
    if (!body || !body.isKind(SyntaxKind.CallExpression)) return null;
    // Method chains (A.from(x).toMethod(y)) have 2 call expressions — not a thin wrapper
    const conciseCallees = new Set<string>();
    node.forEachDescendant((n) => {
      if (!n.isKind(SyntaxKind.CallExpression)) return;
      const cName = extractCalleeName(n);
      if (cName) conciseCallees.add(cName);
    });
    if (conciseCallees.size !== 1) return null;
    const name = extractCalleeName(body);
    if (!name || BUILTIN_NAMES.has(name)) return null;
    return name;
  }

  const stmts = rawBody.getStatements();
  if (stmts.length !== 1) return null;

  const single = stmts.reduce((only) => only);
  // switch → not a wrapper
  if (single.isKind(SyntaxKind.SwitchStatement)) return null;

  let callExpr = null;

  if (single.isKind(SyntaxKind.ReturnStatement)) {
    const expr = single.getExpression();
    if (!expr) return null;
    // factory: return () => ... → not a wrapper
    if (expr.isKind(SyntaxKind.ArrowFunction) || expr.isKind(SyntaxKind.FunctionExpression))
      return null;
    // direct delegation: return someCall(...)
    if (!expr.isKind(SyntaxKind.CallExpression)) return null;
    callExpr = expr;
  } else if (single.isKind(SyntaxKind.ExpressionStatement)) {
    const expr = single.getExpression();
    if (!expr.isKind(SyntaxKind.CallExpression)) return null;
    callExpr = expr;
  } else {
    return null;
  }

  // Ensure the call isn't part of a larger nested-call tree: a direct call
  // has exactly 1 unique callee name across the whole body.
  const allCallees = new Set<string>();
  node.forEachDescendant((n) => {
    if (!n.isKind(SyntaxKind.CallExpression)) return;
    const name = extractCalleeName(n);
    if (name) allCallees.add(name);
  });
  if (allCallees.size !== 1) return null;

  const name = extractCalleeName(callExpr);
  if (!name) return null;
  if (BUILTIN_NAMES.has(name)) return null;

  return name;
}

function extractCalleeName(callNode: ReturnType<FnNode["getBody"]> | undefined): string | null {
  if (!callNode) return null;
  const expr = callNode.isKind(SyntaxKind.CallExpression) ? callNode.getExpression() : null;
  if (!expr) return null;
  if (expr.isKind(SyntaxKind.Identifier)) return expr.getText();
  if (expr.isKind(SyntaxKind.PropertyAccessExpression)) return expr.getName();
  return null;
}

// ── Marker detection ──────────────────────────────────────────────────────

const MARKER_RE = /\/[/*]\s*@wrapper-known(?:\s+([\w-]+))?/;

function extractMarkerReason(node: FnNode): string | null {
  const fullText = node.getSourceFile().getFullText();

  // Anchor node for leading comments:
  //   VariableStatement  → const foo = () => ...
  //   PropertyAssignment → { foo: () => ... }  (marker above the property)
  //   FunctionDeclaration → function foo() { ... }
  const parentNode = node.getParent();
  const anchor =
    node.getFirstAncestorByKind(SyntaxKind.VariableStatement) ??
    (parentNode?.isKind(SyntaxKind.PropertyAssignment) ? parentNode : null) ??
    (node.isKind(SyntaxKind.FunctionDeclaration) ? node : null);

  if (anchor) {
    for (const r of anchor.getLeadingCommentRanges()) {
      const m = MARKER_RE.exec(r.getText());
      if (m) return m[1] ?? "";
    }
  }

  // Trailing comment on the same line
  const end = node.getEnd();
  const eol = fullText.indexOf("\n", end);
  const trailing = fullText.slice(end, eol === -1 ? fullText.length : eol);
  const m = MARKER_RE.exec(trailing);
  if (m) return m[1] ?? "";

  return null;
}

// ── Scan ──────────────────────────────────────────────────────────────────

export function collectFindings(sf: SourceFile): Finding[] {
  const file = path.relative(ROOT, sf.getFilePath());
  const findings: Finding[] = [];

  const check = (node: FnNode) => {
    const fnName = getFnName(node);
    if (!fnName) return;

    const callee = getSingleDirectCallee(node);
    if (!callee) return;
    // Self-recursion / delegation false-positive (same name)
    if (callee === fnName) return;

    const markerReason = extractMarkerReason(node);
    findings.push({
      file,
      line: node.getStartLineNumber(),
      fnName,
      callee,
      markerReason,
    });
  };

  sf.getFunctions().forEach(check);
  sf.getDescendantsOfKind(SyntaxKind.ArrowFunction).forEach(check);
  sf.getDescendantsOfKind(SyntaxKind.FunctionExpression).forEach(check);

  return findings;
}

// ── RepoCheck ─────────────────────────────────────────────────────────────

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts"],
  frameworkWithin: ["packages/*/src/**"],
};

export const check: RepoCheck = {
  name: "Thin-Wrappers Guard",
  run(roots) {
    const project = new Project({
      tsConfigFilePath: frameworkTsConfigPath(),
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
    });

    const paths = scanFiles(SCAN, roots);
    for (const p of paths) project.addSourceFileAtPath(p);

    let scanned = 0;
    const warnings: { file: string; line: number; message: string }[] = [];
    for (const sf of project.getSourceFiles()) {
      if (EXCLUDE.test(sf.getFilePath())) continue;
      scanned++;
      for (const f of collectFindings(sf)) {
        if (f.markerReason === null) {
          warnings.push({ file: f.file, line: f.line, message: `${f.fnName} → ${f.callee}` });
        } else if (!isKnownReason(f.markerReason)) {
          warnings.push({
            file: f.file,
            line: f.line,
            message: `${f.fnName} → ${f.callee}  (reason="${f.markerReason}")`,
          });
        }
      }
    }

    return {
      violations: [],
      warnings: warnings.length > 0 ? warnings : undefined,
      matchedFiles: scanned,
      notApplicable: roots.length === 0,
    };
  },
};

if (import.meta.main) {
  const failed = reportResults(await runRepoChecks([check]));
  process.exit(failed > 0 ? 1 : 0);
}

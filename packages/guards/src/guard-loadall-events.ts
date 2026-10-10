#!/usr/bin/env bun
/**
 * Guard: blocks calls of `loadAllEventsByType()` outside tests,
 * ops scripts and the definition itself.
 *
 * `loadAllEventsByType` buffers ALL events of an aggregate_type in
 * memory (a `SELECT … ORDER BY` without a limit). Beyond ~100k events per
 * type that is an OOM cliff that only shows under prod load — exactly the
 * kind of silent-and-late failure a guard catches before it ships.
 *
 * The memory-bounded replacement is `streamAllEventsByType` (yields in
 * batches, never more than batchSize rows resident). Production projection
 * rebuild already goes through this streaming path. `loadAllEventsByType` stays legitimate
 * for tests (small, controlled stores) and ops scripts on known
 * small aggregate_types — hence the allowlist instead of a removal.
 *
 * Usage:
 *   bun packages/guards/src/guard-loadall-events.ts
 */

import * as path from "node:path";
import { type CallExpression, type SourceFile, SyntaxKind } from "ts-morph";
import {
  type AstGuard,
  type GuardViolation,
  isLocalFinding,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";

const ROOT = process.cwd();

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts"],
  kinds: ["framework", "library"],
};

// Test files may use the API freely — they are the primary verifiers and
// run against small, controlled stores.
const EXCLUDE = /(__tests__|\.test\.ts$|\.integration\.ts$|\.d\.ts$)/;

// Allowed callers: the definition itself + ops/migration scripts (run
// on known small aggregate_types, not in the prod hot path).
// ROOT is anchored to process.cwd() (repo root), the `^` anchor only matches
// real top-level scripts/, not packages/.../scripts/*.
const ALLOWLIST: readonly RegExp[] = [
  /^packages\/framework\/src\/event-store\/event-store\.ts$/,
  /^scripts\//,
];

const GUARDED_CALLS = new Set(["loadAllEventsByType"]);

export interface Violation {
  file: string;
  line: number;
  functionName: string;
  enclosingFunction: string;
}

export function isAllowed(relativePath: string): boolean {
  return ALLOWLIST.some((re) => re.test(relativePath));
}

export function collectViolations(sourceFile: SourceFile): Violation[] {
  const violations: Violation[] = [];
  const relativePath = path.relative(ROOT, sourceFile.getFilePath());
  if (isAllowed(relativePath)) return violations;

  const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
  for (const call of calls) {
    const fnName = getCalleeName(call);
    if (!fnName || !GUARDED_CALLS.has(fnName)) continue;
    violations.push({
      file: relativePath,
      line: call.getStartLineNumber(),
      functionName: fnName,
      enclosingFunction: findEnclosingName(call),
    });
  }
  return violations;
}

// Extract the called name. Handles:
//   loadAllEventsByType(...)        → "loadAllEventsByType"  (Identifier)
//   someNamespace.loadAllEventsByType(...) → "loadAllEventsByType"  (PropertyAccess)
// Any other callee shape returns null.
function getCalleeName(call: CallExpression): string | null {
  const expr = call.getExpression();
  if (expr.getKind() === SyntaxKind.Identifier) {
    return expr.getText();
  }
  if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
    return expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName();
  }
  return null;
}

function findEnclosingName(call: CallExpression): string {
  let cur = call.getParent();
  while (cur) {
    if (cur.isKind(SyntaxKind.FunctionDeclaration) || cur.isKind(SyntaxKind.MethodDeclaration)) {
      return cur.getName() ?? "<anonymous>";
    }
    if (cur.isKind(SyntaxKind.FunctionExpression) || cur.isKind(SyntaxKind.ArrowFunction)) {
      const parent = cur.getParent();
      if (parent?.isKind(SyntaxKind.VariableDeclaration)) return parent.getName();
      if (parent?.isKind(SyntaxKind.PropertyAssignment)) return parent.getName();
      return "<anonymous>";
    }
    cur = cur.getParent();
  }
  return "<top-level>";
}

export const guard: AstGuard = {
  name: "loadAllEventsByType Guard",
  scan: SCAN,
  hint:
    "loadAllEventsByType buffers ALL events of an aggregate_type in memory (OOM cliff > ~100k events). " +
    "Use streamAllEventsByType (batched, memory-bounded) in production code. " +
    "Allowed only in tests, scripts/, and the event-store definition.",
  run(files) {
    const violations: GuardViolation[] = [];
    for (const sf of files) {
      if (EXCLUDE.test(sf.getFilePath())) continue;
      for (const v of collectViolations(sf).filter(isLocalFinding)) {
        violations.push({
          file: v.file,
          line: v.line,
          message: `${v.functionName}(...) in ${v.enclosingFunction}`,
        });
      }
    }
    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);

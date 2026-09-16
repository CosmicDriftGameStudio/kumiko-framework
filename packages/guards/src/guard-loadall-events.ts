#!/usr/bin/env bun
/**
 * Guard: blockt Aufrufe von `loadAllEventsByType()` ausserhalb von Tests,
 * Ops-Scripts und der Definition selbst.
 *
 * `loadAllEventsByType` buffert ALLE Events eines aggregate_type in den
 * Speicher (ein `SELECT … ORDER BY` ohne Limit). Jenseits ~100k Events pro
 * Typ ist das ein OOM-Cliff, der erst unter Prod-Last auffällt — genau die
 * Art still-und-spät-Fehler, die ein Guard fängt bevor sie ausgeliefert wird.
 *
 * Der memory-bounded Ersatz ist `streamAllEventsByType` (yield't batchweise,
 * nie mehr als batchSize Rows resident). Production-Projection-Rebuild geht
 * bereits über diesen Streaming-Pfad. `loadAllEventsByType` bleibt legitim
 * für Tests (kleine, kontrollierte Stores) und Ops-Scripts auf bekannt
 * kleinen aggregate_types — daher die Allowlist statt einer Entfernung.
 *
 * Usage:
 *   bun packages/guards/src/guard-loadall-events.ts
 */

import * as path from "node:path";
import { type CallExpression, type Identifier, type SourceFile, SyntaxKind } from "ts-morph";
import { type AstGuard, type GuardViolation, runStandalone, type ScanSpec } from "./_lib/guard-kit";

const ROOT = process.cwd();

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts"],
  kinds: ["framework", "library"],
};

// Test-Dateien dürfen die API frei benutzen — sie sind die primären
// Verifizierer und laufen gegen kleine, kontrollierte Stores.
const EXCLUDE = /(__tests__|\.test\.ts$|\.integration\.ts$|\.d\.ts$)/;

// Erlaubte Aufrufer: die Definition selbst + Ops-/Migration-Scripts (laufen
// auf bekannt kleinen aggregate_types, nicht im Prod-Hot-Path).
// ROOT ist gegen process.cwd() (Repo-Root) verankert, `^`-Anker matcht nur
// echte Top-Level-scripts/, nicht packages/.../scripts/*.
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
    return (expr as Identifier).getText();
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
      for (const v of collectViolations(sf)) {
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

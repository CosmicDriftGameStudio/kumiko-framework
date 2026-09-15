#!/usr/bin/env bun
/**
 * Guard: blocks calls to the event-store admin API (`appendRaw`/`appendRawBatch`)
 * outside allowed paths.
 *
 * The admin API is a Marten bypass for legacy data imports (prod-readiness
 * wave 3, step 3.1). It BYPASSES the pipeline — no projections, no
 * postSave hooks, no SSE/search/audit. Used accidentally from application
 * code, that causes state inconsistencies that surface very late (at the
 * next projection rebuild, or never).
 *
 * Second line of defense next to the deep-import path: even if someone pulls
 * `@kubiko/framework/event-store/admin-api` directly, this guard catches it
 * at the next `bun kumiko check`.
 *
 * Usage:
 *   bun guards/guard-admin-api.ts
 *
 * Exit 1 if violations found, 0 if clean.
 */

import * as path from "node:path";
import { type CallExpression, type Identifier, type SourceFile, SyntaxKind } from "ts-morph";
import { type AstGuard, runStandalone, type ScanSpec } from "./_lib/guard-kit";

const ROOT = process.cwd();

const SCAN: ScanSpec = { scope: "source", extensions: ["ts"] };

// Test files may use the API freely — they are the primary verifiers.
// App code is never shipped through tests.
const EXCLUDE = /(__tests__|\.test\.ts$|\.integration\.ts$|\.d\.ts$)/;

// Allowed callers: migration runners (sample-local, src/ and bin/) +
// admin scripts + the definition itself + this guard script.
const ALLOWLIST: readonly RegExp[] = [
  /^samples\/[^/]+\/src\/migration\//,
  /^scripts\/migrations\//,
  /^packages\/framework\/src\/event-store\/admin-api\.ts$/,
  /^scripts\/guard-admin-api\.ts$/,
];

const GUARDED_CALLS = new Set(["appendRaw", "appendRawBatch"]);

export interface Violation {
  file: string;
  line: number;
  functionName: string;
  enclosingFunction: string;
}

function collectViolations(sourceFile: SourceFile): Violation[] {
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

function isAllowed(relativePath: string): boolean {
  return ALLOWLIST.some((re) => re.test(relativePath));
}

// Extract the called name. Handles:
//   appendRaw(...)              → "appendRaw"   (Identifier)
//   someNamespace.appendRaw(...) → "appendRaw"  (PropertyAccessExpression)
// Any other callee shape returns null — we only want bare-name / qualified-name
// references to the known function names.
function getCalleeName(call: CallExpression): string | null {
  const expr = call.getExpression();
  if (expr.getKind() === SyntaxKind.Identifier) {
    return (expr as Identifier).getText();
  }
  if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
    const name = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName();
    return name;
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
  name: "Admin-API Guard",
  scan: SCAN,
  // App repos are not exempt — appendRaw/appendRawBatch bypasses the pipeline there too (infra#502).
  security: true,
  hint: "Admin-API (appendRaw/appendRawBatch) umgeht die Pipeline — erlaubt nur in samples/*/migration/ oder scripts/migrations/. Für Domain-Events: ctx.appendEvent / write-Handler.",
  run(files) {
    const violations: Array<{ file: string; line: number; message: string }> = [];

    for (const sf of files) {
      const file = sf.getFilePath();
      if (EXCLUDE.test(file)) continue;
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

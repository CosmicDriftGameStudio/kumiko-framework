#!/usr/bin/env bun
/**
 * Guard: `openToAll` access declarations need a real reason.
 *
 * The framework boot validator (access-declarations.ts) already rejects an
 * empty `reason`, and separately checks `openToAll.personalData` on
 * query/stream handlers and a PII write that is neither owner-bound nor
 * declares `personalData` — none of that is this
 * guard's job. This guard only catches what the boot validator can't: a
 * `reason` string that IS non-empty but is a placeholder (`"todo"`,
 * `"legacy"`, ...), plus the deprecated bare `openToAll: true` shape.
 *
 * Usage:
 *   bun guards/guard-open-to-all-reason.ts
 *   Baseline: bun guards/run-guards.ts --write-security-baseline
 */
import * as path from "node:path";
import { type SourceFile, SyntaxKind } from "ts-morph";
import { isGenericReason, literalReasonText } from "./_lib/generic-reason";
import { type AstGuard, type GuardViolation, runStandalone, type ScanSpec } from "./_lib/guard-kit";

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts"],
  frameworkWithin: ["packages/*/src/**", "samples/**"],
};
const EXCLUDE = /(__tests__\/|\.test\.tsx?$|\.d\.ts$)/;

function scannableFiles(files: readonly SourceFile[]): SourceFile[] {
  return files.filter((sf) => !EXCLUDE.test(sf.getFilePath()));
}

function openToAllPropertyAssignments(sf: SourceFile) {
  return sf
    .getDescendantsOfKind(SyntaxKind.PropertyAssignment)
    .filter((pa) => pa.getName() === "openToAll");
}

export function findDeprecatedOpenToAll(
  files: readonly SourceFile[],
  root: string,
): { file: string; line: number; message: string }[] {
  const out: { file: string; line: number; message: string }[] = [];
  for (const sf of scannableFiles(files)) {
    for (const pa of openToAllPropertyAssignments(sf)) {
      if (pa.getInitializer()?.getKind() !== SyntaxKind.TrueKeyword) continue;
      out.push({
        file: path.relative(root, sf.getFilePath()),
        line: pa.getStartLineNumber(),
        message:
          'openToAll: true is deprecated — replace with openToAll: { reason: "<why any authenticated user may call this>" } (+ personalData: "tenant-members" for write handlers with unbound personal data).',
      });
    }
  }
  return out;
}

export function findGenericOpenToAllReasons(
  files: readonly SourceFile[],
  root: string,
): { file: string; line: number; message: string }[] {
  const out: { file: string; line: number; message: string }[] = [];
  for (const sf of scannableFiles(files)) {
    for (const pa of openToAllPropertyAssignments(sf)) {
      const init = pa.getInitializer();
      if (!init?.isKind(SyntaxKind.ObjectLiteralExpression)) continue;
      const reasonProp = init.getProperty("reason");
      if (!reasonProp?.isKind(SyntaxKind.PropertyAssignment)) continue;
      const reasonText = literalReasonText(reasonProp.getInitializer());
      if (reasonText === undefined) continue;
      if (reasonText.trim() === "") continue;
      if (!isGenericReason(reasonText)) continue;
      out.push({
        file: path.relative(root, sf.getFilePath()),
        line: pa.getStartLineNumber(),
        message: `openToAll: { reason: "${reasonText}" } uses a placeholder reason — give a concrete justification for why any authenticated user may call this.`,
      });
    }
  }
  return out;
}

export function createOpenToAllReasonGuard(opts: { root: string }): AstGuard {
  return {
    name: "Open-To-All-Reason Guard",
    scan: SCAN,
    security: true,
    hint: 'openToAll: { reason: "<why any authenticated user may call this>" } angeben (+ personalData: "tenant-members" bei Write-Handlern mit nicht gebundenen Personendaten). Baseline nach bewusster Reduktion: `bun guards/run-guards.ts --write-security-baseline`',
    run(files) {
      const violations: GuardViolation[] = [
        ...findGenericOpenToAllReasons(files, opts.root).map((f) => ({
          file: f.file,
          line: f.line,
          message: f.message,
          neverFrozen: true,
        })),
        ...findDeprecatedOpenToAll(files, opts.root).map((f) => ({
          file: f.file,
          line: f.line,
          message: f.message,
        })),
      ];
      return { violations };
    },
  };
}

export const guard = createOpenToAllReasonGuard({ root: process.cwd() });

if (import.meta.main) {
  runStandalone(guard);
}

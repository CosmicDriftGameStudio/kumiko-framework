#!/usr/bin/env bun
/**
 * Warns when a `.unsafe(sql, [...])` parameter list holds a JS array (or a spread).
 *
 * Bun.SQL binds a JS array parameter as "a,b" on Linux, so `ANY($n)` fails with a
 * malformed array literal in CI while the same call passes on macOS. Pass
 * `toPostgresArrayLiteral(values)` (from `@cosmicdrift/kumiko-framework/db`) and cast the
 * placeholder (`$1::text[]`).
 *
 * Heuristic without type info: only array literals and spreads directly inside the
 * parameter-list literal are reported; array-typed variables pass unnoticed. Warning only.
 */

import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { Node, Project, type SourceFile, SyntaxKind } from "ts-morph";
import {
  type GuardViolation,
  type RepoCheck,
  reportResults,
  runRepoChecks,
} from "./_lib/guard-kit";
import { type ScanSpec, scanFiles } from "./_lib/scan-scope";

const SCAN: ScanSpec = { scope: "source+tests", extensions: ["ts", "tsx"] };

const UNSAFE_CALL_MARKER = ".unsafe";
const UNSAFE_PARAMS_ARG_INDEX = 1;

const FIX_HINT =
  "pass toPostgresArrayLiteral(values) from @cosmicdrift/kumiko-framework/db and cast the placeholder, e.g. ANY($1::text[])";

export type UnsafeArrayParamFinding = {
  readonly line: number;
  readonly message: string;
};

function unwrapExpression(node: Node): Node {
  let current = node;
  while (
    Node.isAsExpression(current) ||
    Node.isSatisfiesExpression(current) ||
    Node.isParenthesizedExpression(current)
  ) {
    current = current.getExpression();
  }
  return current;
}

export function findUnsafeArrayParams(sf: SourceFile): UnsafeArrayParamFinding[] {
  const findings: UnsafeArrayParamFinding[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== "unsafe") continue;
    const params = call.getArguments()[UNSAFE_PARAMS_ARG_INDEX];
    if (params === undefined) continue;
    const paramList = unwrapExpression(params);
    if (!Node.isArrayLiteralExpression(paramList)) continue;
    for (const element of paramList.getElements()) {
      const value = unwrapExpression(element);
      if (Node.isArrayLiteralExpression(value)) {
        findings.push({
          line: element.getStartLineNumber(),
          message: `array literal as an unsafe() parameter binds as "a,b" on Linux; ${FIX_HINT}`,
        });
      } else if (Node.isSpreadElement(element)) {
        findings.push({
          line: element.getStartLineNumber(),
          message: `spread in the unsafe() parameter list; if it feeds ANY($n), ${FIX_HINT}`,
        });
      }
    }
  }
  return findings;
}

export const check: RepoCheck = {
  name: "Unsafe Array Param Guard",
  hint:
    "Bun.SQL binds a JS array parameter as 'a,b' on Linux (CI) but not on macOS. " +
    "Use toPostgresArrayLiteral(values) with a $n::type[] cast in unsafe() calls.",
  run(roots) {
    const paths = scanFiles(SCAN, roots);
    const project = new Project({ skipAddingFilesFromTsConfig: true, useInMemoryFileSystem: true });
    const warnings: GuardViolation[] = [];
    for (const absPath of paths) {
      const text = readFileSync(absPath, "utf-8");
      if (!text.includes(UNSAFE_CALL_MARKER)) continue;
      const sf = project.createSourceFile(absPath, text, { overwrite: true });
      for (const finding of findUnsafeArrayParams(sf)) {
        warnings.push({
          file: relative(process.cwd(), absPath),
          line: finding.line,
          message: finding.message,
        });
      }
    }
    return {
      violations: [],
      warnings: warnings.length > 0 ? warnings : undefined,
      matchedFiles: paths.length,
      notApplicable: false,
    };
  },
};

if (import.meta.main) {
  const failed = reportResults(await runRepoChecks([check]));
  process.exit(failed > 0 ? 1 : 0);
}

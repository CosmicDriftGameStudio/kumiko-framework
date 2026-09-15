#!/usr/bin/env bun
/**
 * Guard: JSON.parse calls must be inside a try/catch OR routed through the
 * safe-json helpers (parseJsonSafe / parseJsonOrThrow). Bare JSON.parse on
 * data from external systems (Redis, DB, HTTP) crashes the pipeline silently
 * with a SyntaxError when input is corrupt.
 *
 * Usage:
 *   bun guards/guard-unsafe-json-parse.ts
 */

import * as path from "node:path";
import { type Node, type SourceFile, SyntaxKind } from "ts-morph";
import { type AstGuard, runStandalone, type ScanSpec } from "./_lib/guard-kit";

const ROOT = process.cwd();

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts"],
  frameworkWithin: ["packages/*/src/**"],
};

const EXCLUDE = /(__tests__|\.test\.ts$|\.integration\.ts$|\.d\.ts$|safe-json\.ts$)/;

interface UnsafeSite {
  file: string;
  line: number;
  snippet: string;
}

function isInsideTry(node: Node): boolean {
  let cur: Node | undefined = node.getParent();
  while (cur) {
    if (cur.isKind(SyntaxKind.TryStatement)) {
      const tryBlock = cur.asKindOrThrow(SyntaxKind.TryStatement).getTryBlock();
      if (
        tryBlock &&
        node.getStart() >= tryBlock.getStart() &&
        node.getEnd() <= tryBlock.getEnd()
      ) {
        return true;
      }
    }
    cur = cur.getParent();
  }
  return false;
}

function scanFile(sf: SourceFile): UnsafeSite[] {
  const sites: UnsafeSite[] = [];
  const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression);
  for (const call of calls) {
    const expr = call.getExpression();
    if (expr.getText() !== "JSON.parse") continue;
    if (isInsideTry(call)) continue;
    sites.push({
      file: path.relative(ROOT, sf.getFilePath()),
      line: call.getStartLineNumber(),
      snippet: call.getText().slice(0, 80),
    });
  }
  return sites;
}

export const guard: AstGuard = {
  name: "Unsafe-JSON-Parse Guard",
  scan: SCAN,
  hint: "Nutze parseJsonSafe (Cache-Semantik) oder parseJsonOrThrow (Boundary-Semantik) aus utils/safe-json.",
  run(files) {
    const violations: Array<{ file: string; line: number; message: string }> = [];
    for (const sf of files) {
      if (EXCLUDE.test(sf.getFilePath())) continue;
      for (const site of scanFile(sf)) {
        violations.push({
          file: site.file,
          line: site.line,
          message: `unguarded JSON.parse — ${site.snippet}`,
        });
      }
    }
    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);

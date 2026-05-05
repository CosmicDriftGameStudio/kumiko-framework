/**
 * Guard: JSON.parse calls must be inside a try/catch OR routed through the
 * safe-json helpers (parseJsonSafe / parseJsonOrThrow). Bare JSON.parse on
 * data from external systems (Redis, DB, HTTP) crashes the pipeline silently
 * with a SyntaxError when input is corrupt.
 *
 * Usage:
 *   yarn tsx scripts/guard-unsafe-json-parse.ts
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type Node, Project, type SourceFile, SyntaxKind } from "ts-morph";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const SCAN_GLOBS = [
  "packages/framework/src/**/*.ts",
  "packages/bundled-features/src/**/*.ts",
];

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
      const tryBlock = (cur.asKindOrThrow(SyntaxKind.TryStatement)).getTryBlock();
      if (tryBlock && node.getStart() >= tryBlock.getStart() && node.getEnd() <= tryBlock.getEnd()) {
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

function main(): void {
  const project = new Project({
    tsConfigFilePath: path.join(ROOT, "packages/framework/tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  for (const glob of SCAN_GLOBS) {
    project.addSourceFilesAtPaths(path.join(ROOT, glob));
  }

  const violations: UnsafeSite[] = [];
  let scanned = 0;
  for (const sf of project.getSourceFiles()) {
    if (EXCLUDE.test(sf.getFilePath())) continue;
    scanned++;
    violations.push(...scanFile(sf));
  }

  console.log(`Unsafe-JSON-Parse Guard: ${scanned} Dateien gepruefft.`);

  if (violations.length === 0) {
    console.log("  Keine ungeschuetzten JSON.parse Calls.");
    return;
  }

  console.error(`\n  BLOCKED: ${violations.length} JSON.parse Calls ohne try/catch:\n`);
  for (const v of violations) {
    console.error(`    ${v.file}:${v.line}  ${v.snippet}`);
  }
  console.error(
    "\n  Nutze parseJsonSafe (Cache-Semantik) oder parseJsonOrThrow (Boundary-Semantik) aus utils/safe-json.\n",
  );
  process.exit(1);
}

main();

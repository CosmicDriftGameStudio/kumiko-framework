/**
 * Guard: Tests must actually assert something. Flags:
 *   (a) Always-true assertions: expect(true).toBe(true), expect(1).toBe(1)
 *   (b) Test bodies with zero expect() calls
 *
 * Both are silent failures — they count as "passing" but prove nothing. In
 * integration tests this is particularly toxic, since the whole point is to
 * prove wiring against the real stack.
 *
 * Usage:
 *   yarn tsx scripts/guard-fake-tests.ts
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type CallExpression, Node, Project, type SourceFile, SyntaxKind } from "ts-morph";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const SCAN_GLOBS = [
  "packages/framework/src/**/*.{test,integration}.ts",
  "packages/bundled-features/src/**/*.{test,integration}.ts",
];

interface Violation {
  file: string;
  line: number;
  kind: "tautology" | "no-expect";
  detail: string;
}

const TAUTOLOGIES = [
  /^expect\(\s*true\s*\)\.toBe\(\s*true\s*\)$/,
  /^expect\(\s*false\s*\)\.toBe\(\s*false\s*\)$/,
  /^expect\(\s*1\s*\)\.toBe\(\s*1\s*\)$/,
  /^expect\(\s*['"]\w+['"]\s*\)\.toBe\(\s*['"]\w+['"]\s*\)$/,
];

function isTestCall(call: CallExpression): boolean {
  const expr = call.getExpression();
  const text = expr.getText();
  return text === "it" || text === "test";
}

// Helpers that internally call `expect(...)` and assert something — treating
// a call to one of these as equivalent to a direct `expect()` in the body.
// Extend this list only when a new wrapper provides a real assertion (not a
// silent-noop alias), otherwise it re-opens the "no expect" escape hatch.
const ASSERTION_HELPER_NAMES = new Set([
  "expectError",
  "expectSuccess",
  "expectErrorIncludes",
  // expectTypeOf — Vitest's compile-time type assertion. Failures show up as
  // tsc errors (e.g. TS2344 "Type 'X' does not satisfy ..."), not as runtime
  // expect failures, but they ARE real assertions on the type level.
  "expectTypeOf",
]);

function countExpects(node: Node): number {
  let n = 0;
  node.forEachDescendant((d) => {
    if (d.isKind(SyntaxKind.CallExpression)) {
      const name = d.getExpression().getText();
      if (name === "expect" || name.startsWith("expect.")) {
        n++;
      } else if (ASSERTION_HELPER_NAMES.has(name)) {
        n++;
      }
    }
  });
  return n;
}

function scanFile(sf: SourceFile): Violation[] {
  const violations: Violation[] = [];
  const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression);

  for (const call of calls) {
    // (a) tautology: full expression text matches a known trivial pattern
    const text = call.getText().replace(/\s+/g, " ").trim();
    if (TAUTOLOGIES.some((re) => re.test(text))) {
      violations.push({
        file: path.relative(ROOT, sf.getFilePath()),
        line: call.getStartLineNumber(),
        kind: "tautology",
        detail: text.slice(0, 60),
      });
      continue;
    }

    // (b) no-expect: it/test with empty expect count
    if (!isTestCall(call)) continue;
    const args = call.getArguments();
    if (args.length < 2) continue;
    const body = args[1];
    if (!body) continue;
    const isArrowOrFn =
      body.isKind(SyntaxKind.ArrowFunction) || body.isKind(SyntaxKind.FunctionExpression);
    if (!isArrowOrFn) continue;
    const nExpect = countExpects(body);
    if (nExpect === 0) {
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

function main(): void {
  const project = new Project({
    tsConfigFilePath: path.join(ROOT, "packages/framework/tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  for (const glob of SCAN_GLOBS) {
    project.addSourceFilesAtPaths(path.join(ROOT, glob));
  }

  const violations: Violation[] = [];
  let scanned = 0;
  for (const sf of project.getSourceFiles()) {
    scanned++;
    violations.push(...scanFile(sf));
  }

  console.log(`Fake-Test Guard: ${scanned} Test-Dateien gepruefft.`);

  if (violations.length === 0) {
    console.log("  Keine Fake-Tests.");
    return;
  }

  console.error(`\n  BLOCKED: ${violations.length} verdaechtige Test-Stellen:\n`);
  for (const v of violations) {
    const label = v.kind === "tautology" ? "TAUTOLOGY" : "NO EXPECT ";
    console.error(`    ${label}  ${v.file}:${v.line}  ${v.detail}`);
  }
  console.error("");
  process.exit(1);
}

main();

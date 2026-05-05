/**
 * Guard: `details.reason` strings and the first arg to UnprocessableError /
 * failUnprocessable must follow the reason convention:
 *
 *    ^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$
 *
 * That is: lowercase ASCII, underscores for word breaks, optional dot
 * namespaces for feature-scoped reasons (e.g. `order.already_cancelled`).
 * No spaces, no camelCase, no dashes, no leading digits.
 *
 * Why: reason codes survive the wire + logs + i18n lookup. Clients key off
 * them. Any drift (camelCase, typos like `stale_stat`) means a missed
 * branch in the SDK. Catching it at commit time is dramatically cheaper
 * than discovering a client-side dead branch in prod.
 *
 * What this checks:
 *   1. `new UnprocessableError(X, ...)` — X must be a string-literal reason
 *      that matches the regex, OR a reference to a known Reasons const
 *      (FrameworkReasons.*, <Anything>Reasons.*, TenantErrors.*, etc.).
 *   2. `failUnprocessable(X, ...)` — same rule.
 *   3. Object literals containing `reason: "X"` — same rule for the X.
 *
 * Non-literal reasons (computed, template strings with interpolation,
 * identifier references) are assumed to be typed-from-a-const and pass.
 * A stricter version could walk to the declaration; v1 stays pragmatic.
 *
 * Usage:
 *   yarn tsx scripts/guard-error-reasons.ts
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Node, Project, type SourceFile, SyntaxKind } from "ts-morph";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const SCAN_GLOBS = [
  "packages/framework/src/**/*.ts",
  "packages/bundled-features/src/**/*.ts",
  "samples/**/*.ts",
];

// Excluded: test files (they may legitimately fabricate broken reasons to
// prove the guard catches them) and the classes.ts / reasons.ts definitions
// themselves (message text in constructor defaults isn't a reason).
const EXCLUDE =
  /(__tests__|\.test\.ts$|\.integration\.ts$|\.d\.ts$|errors\/classes\.ts$|errors\/reasons\.ts$|node_modules)/;

const REASON_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

// Calls whose first positional arg is a reason string.
const UNPROC_CALL_NAMES = new Set(["UnprocessableError", "failUnprocessable"]);

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly kind: "unproc-arg" | "details-reason";
  readonly value: string;
}

function scanFile(sf: SourceFile): Violation[] {
  const violations: Violation[] = [];

  // ---------- (1) + (2): UnprocessableError / failUnprocessable calls ----------
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    // Strip `new `, drop qualifying module access. We only need the final
    // identifier for the call name check.
    const text = callee.getText();
    const name = text.split(".").pop() ?? text;

    // Also catch `new UnprocessableError(...)` — ts-morph models that as a
    // NewExpression, but class-ref-as-callable in our codebase is exercised
    // only in tests/internal, so the NewExpression pass below handles it.
    if (!UNPROC_CALL_NAMES.has(name)) continue;

    const arg = call.getArguments()[0];
    const bad = checkReasonNode(arg);
    if (bad !== null) {
      violations.push({
        file: path.relative(ROOT, sf.getFilePath()),
        line: call.getStartLineNumber(),
        kind: "unproc-arg",
        value: bad,
      });
    }
  }

  for (const neu of sf.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const callee = neu.getExpression();
    const text = callee.getText();
    const name = text.split(".").pop() ?? text;
    if (name !== "UnprocessableError") continue;

    const arg = neu.getArguments()[0];
    const bad = checkReasonNode(arg);
    if (bad !== null) {
      violations.push({
        file: path.relative(ROOT, sf.getFilePath()),
        line: neu.getStartLineNumber(),
        kind: "unproc-arg",
        value: bad,
      });
    }
  }

  // ---------- (3): object literals with `reason: "..."` ----------
  for (const prop of sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
    const name = prop.getName();
    if (name !== "reason") continue;

    const initializer = prop.getInitializer();
    const bad = checkReasonNode(initializer);
    if (bad !== null) {
      violations.push({
        file: path.relative(ROOT, sf.getFilePath()),
        line: prop.getStartLineNumber(),
        kind: "details-reason",
        value: bad,
      });
    }
  }

  return violations;
}

// Returns the offending string if this node is a string literal that does
// NOT match the reason regex; null otherwise (including for non-literals —
// those are assumed to come from a typed const and slip through).
function checkReasonNode(node: Node | undefined): string | null {
  if (!node) return null;
  if (node.isKind(SyntaxKind.StringLiteral)) {
    const lit = node.getLiteralText();
    return REASON_RE.test(lit) ? null : lit;
  }
  if (node.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
    const lit = node.getLiteralText();
    return REASON_RE.test(lit) ? null : lit;
  }
  return null;
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
    if (EXCLUDE.test(sf.getFilePath())) continue;
    scanned++;
    violations.push(...scanFile(sf));
  }

  console.log(`Error-Reasons Guard: ${scanned} Dateien gepruefft.`);

  if (violations.length === 0) {
    console.log("  Alle Reason-Strings folgen der Konvention.");
    return;
  }

  console.error(`\n  BLOCKED: ${violations.length} Reason-Strings verletzen die Konvention:\n`);
  for (const v of violations) {
    const where = v.kind === "unproc-arg" ? "UnprocessableError/failUnprocessable" : "details.reason";
    console.error(`    ${v.file}:${v.line}  ${where}  "${v.value}"`);
  }
  console.error(
    `
  Regel: reason-strings muessen ${REASON_RE} matchen.
    → snake_case ASCII
    → optional dot-namespaced (z.B. "order.already_cancelled")
    → keine camelCase, Leerzeichen, Minus, Leading-Digits

  Wiederverwendbares Reason? Lege einen const ab (FrameworkReasons fuer
  framework-weit, <Feature>Reasons fuer feature-lokal) und nutze die
  Konstante statt des String-Literals.\n`,
  );
  process.exit(1);
}

main();

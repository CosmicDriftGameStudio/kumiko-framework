/**
 * Guard: blockt Aufrufe der Event-Store Admin-API (`appendRaw`/`appendRawBatch`)
 * ausserhalb erlaubter Pfade.
 *
 * Die Admin-API ist ein Marten-Bypass für Legacy-Daten-Importe (Prod-Readiness
 * Welle 3, Step 3.1). Sie UMGEHT die Pipeline — keine Projections, keine
 * postSave-Hooks, keine SSE/Search/Audit. Wird sie versehentlich aus
 * Applikations-Code benutzt, führt das zu State-Inkonsistenzen, die sehr spät
 * auffallen (beim nächsten Projection-Rebuild oder gar nicht).
 *
 * Zweite Verteidigungslinie neben dem deep-import-Pfad: auch wenn jemand
 * `@kubiko/framework/event-store/admin-api` zieht, fällt dieser Guard beim
 * nächsten `yarn kumiko check` auf.
 *
 * Usage:
 *   yarn tsx scripts/guard-admin-api.ts
 *
 * Exit 1 wenn Verstoesse gefunden, 0 wenn sauber.
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type CallExpression,
  Project,
  type SourceFile,
  SyntaxKind,
  type Identifier,
} from "ts-morph";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const SCAN_GLOBS = [
  "packages/framework/src/**/*.ts",
  "packages/bundled-features/src/**/*.ts",
  "samples/**/*.ts",
  "scripts/**/*.ts",
];

// Test-Dateien dürfen die API frei benutzen — sie sind die primären
// Verifizierer. App-Code wird nicht ausgeliefert über Tests.
const EXCLUDE = /(__tests__|\.test\.ts$|\.integration\.ts$|\.d\.ts$)/;

// Erlaubte Aufrufer: Migration-Runner (sample-lokal, src/ und bin/) +
// Admin-Scripts + die Definition selbst + dieses Guard-Script.
// Showcase-Samples leben unter samples/showcases/<name>/, der Pfad ist
// dieselbe Bedeutung wie samples/<name>/ — beide allowed.
const ALLOWLIST: readonly RegExp[] = [
  /^samples\/[^/]+\/src\/migration\//,
  /^samples\/showcases\/[^/]+\/src\/migration\//,
  /^samples\/showcases\/[^/]+\/bin\//,
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
    if (
      cur.isKind(SyntaxKind.FunctionDeclaration) ||
      cur.isKind(SyntaxKind.MethodDeclaration)
    ) {
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

function main(): void {
  const project = new Project({
    tsConfigFilePath: path.join(ROOT, "packages/framework/tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });

  for (const glob of SCAN_GLOBS) {
    project.addSourceFilesAtPaths(path.join(ROOT, glob));
  }

  const violations: Violation[] = [];
  let scannedFiles = 0;

  for (const sf of project.getSourceFiles()) {
    const file = sf.getFilePath();
    if (EXCLUDE.test(file)) continue;
    scannedFiles++;
    violations.push(...collectViolations(sf));
  }

  console.log(
    `Admin-API Guard: ${scannedFiles} Dateien gescannt, ${violations.length} Verstoesse.`,
  );

  if (violations.length === 0) {
    console.log("  Keine bemaengelten Stellen.");
    return;
  }

  console.error(`\n  BLOCKED: ${violations.length} direkte Aufrufe der Admin-API:\n`);
  for (const v of violations) {
    console.error(
      `    ${v.file}:${v.line}  ${v.functionName}(...) in ${v.enclosingFunction}`,
    );
  }
  console.error(
    "\n  Die Admin-API (appendRaw/appendRawBatch) umgeht die Pipeline.",
  );
  console.error(
    "  Erlaubt nur in samples/*/migration/ oder scripts/migrations/.",
  );
  console.error(
    "  Fuer normale Domain-Events: ctx.appendEvent oder write-Handler nutzen.\n",
  );
  process.exit(1);
}

main();

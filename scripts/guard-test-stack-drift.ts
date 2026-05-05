/**
 * Guard: *.integration.ts files duerfen kein paralleles Server-Stack
 * konstruieren. Konkret: wenn der Test weder `buildServer(...)` noch
 * `setupTestStack(...)` aufruft, aber dennoch Pipeline-Interna wie
 * `createDispatcher`, `createOutboxPoller` oder `createLifecycleHooks`
 * direkt instanziiert, baut er sich eine Test-Realitaet neben der
 * Produktions-Verdrahtung — genau die Drift-Quelle, die grue Tests bei
 * kaputtem Prod-Pfad produziert.
 *
 * Erlaubter Opt-out: `// @no-server-stack: <grund>` irgendwo im File.
 * Gedacht fuer reine Adapter-Integration-Tests (DB, Redis, Meilisearch),
 * die absichtlich keinen Server hochfahren.
 *
 * Usage:
 *   yarn tsx scripts/guard-test-stack-drift.ts
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Project, type SourceFile, SyntaxKind } from "ts-morph";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const INTEGRATION_GLOBS = [
  "packages/framework/src/**/*.integration.ts",
  "packages/bundled-features/src/**/*.integration.ts",
];

// Functions whose call in an integration test signals "I build the server".
// If any of these are called, the file is considered "properly wired".
const SERVER_ENTRYPOINTS = new Set(["buildServer", "setupTestStack"]);

// Pipeline-internal factories. Calling any of these WITHOUT also calling a
// server entrypoint means the test is assembling its own parallel stack.
const FORBIDDEN_WITHOUT_SERVER = new Set([
  "createDispatcher",
  "createOutboxPoller",
  "createLifecycleHooks",
]);

const OPT_OUT_MARKER = /\/\/\s*@no-server-stack:/i;

interface Violation {
  file: string;
  reason: string;
  forbiddenCalls: Array<{ name: string; line: number }>;
}

function collectCallNames(sf: SourceFile): Map<string, number[]> {
  const calls = new Map<string, number[]>();
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = call.getExpression().getText();
    const arr = calls.get(name) ?? [];
    arr.push(call.getStartLineNumber());
    calls.set(name, arr);
  }
  return calls;
}

function hasOptOutMarker(sf: SourceFile): boolean {
  return OPT_OUT_MARKER.test(sf.getFullText());
}

function scanFile(sf: SourceFile): Violation | null {
  if (hasOptOutMarker(sf)) return null;

  const calls = collectCallNames(sf);

  const hasServerEntrypoint = [...SERVER_ENTRYPOINTS].some((name) => calls.has(name));
  if (hasServerEntrypoint) return null;

  const forbiddenHits: Array<{ name: string; line: number }> = [];
  for (const [name, lines] of calls) {
    if (FORBIDDEN_WITHOUT_SERVER.has(name)) {
      for (const line of lines) forbiddenHits.push({ name, line });
    }
  }

  if (forbiddenHits.length === 0) return null;

  return {
    file: path.relative(ROOT, sf.getFilePath()),
    reason: "calls pipeline internals without buildServer/setupTestStack",
    forbiddenCalls: forbiddenHits,
  };
}

function main(): void {
  const project = new Project({
    tsConfigFilePath: path.join(ROOT, "packages/framework/tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  for (const glob of INTEGRATION_GLOBS) {
    project.addSourceFilesAtPaths(path.join(ROOT, glob));
  }

  const violations: Violation[] = [];
  let scanned = 0;
  for (const sf of project.getSourceFiles()) {
    if (!/\.integration\.ts$/.test(sf.getFilePath())) continue;
    scanned++;
    const v = scanFile(sf);
    if (v) violations.push(v);
  }

  console.log(`Test-Stack-Drift Guard: ${scanned} Integration-Tests gepruefft.`);

  if (violations.length === 0) {
    console.log("  Alle Integration-Tests nutzen buildServer oder setupTestStack.");
    return;
  }

  console.error(`\n  BLOCKED: ${violations.length} Integration-Tests mit parallelem Stack:\n`);
  for (const v of violations) {
    console.error(`    ${v.file}`);
    for (const c of v.forbiddenCalls) {
      console.error(`      line ${c.line}: ${c.name}(...)`);
    }
  }
  console.error(
    "\n  Integration-Tests muessen buildServer oder setupTestStack aufrufen — sonst testen sie eine andere Realitaet als Prod.",
  );
  console.error(
    "  Wenn der Test absichtlich kein Server-Stack hochfaehrt (reine Adapter-Tests), markiere mit `// @no-server-stack: <grund>`.\n",
  );
  process.exit(1);
}

main();

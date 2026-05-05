// Runtime-Isolation-Guard.
//
// Verhindert, dass Production-Code (runtime) Test- oder Tooling-Module
// transitiv lädt — der konkrete Anlass war ein Vitest-Top-Level-Import in
// `framework/testing/expect-error.ts`, der drizzle-kit unter Node crashen
// ließ. Jede Datei kriegt einen Runtime-Kontext zugeordnet, jede Import-
// Kante wird gegen eine Compat-Matrix geprüft.
//
// Klassifikation pro File (höchste Priorität zuerst):
//   1. File-Direktive  →  // @runtime <kind>  in den ersten 5 Zeilen
//   2. Pfad-Pattern    →  *.test.ts, *.integration.ts, *.e2e.ts,
//                         **/__tests__/**, **/testing/**  → test
//   3. Workspace       →  package.json `"kumiko": { "runtime": "..." }`
//   4. Default         →  runtime
//
// Compat-Matrix: Welcher Runtime-Kontext darf welchen importieren.
//   runtime → runtime, client
//   client  → client
//   dev     → runtime, client, dev, tooling
//   tooling → runtime, client, dev, tooling
//   test    → alles
//
// Aufruf:
//   bun scripts/check-runtime-isolation.ts          # check, exit 1 bei Drift
//   bun scripts/check-runtime-isolation.ts --json   # maschinen-lesbar
//
// Pure Klassifikation lebt in `runtime-isolation-classify.ts` — dort
// stehen die Regex-Tabellen und der workspace-walk, hier nur ts-morph
// + Reporting.

import * as path from "node:path";
import { Project } from "ts-morph";
import {
  classify,
  COMPAT,
  type Runtime,
} from "./runtime-isolation-classify";

const REPO_ROOT = path.resolve(__dirname, "..");

// Cache: workspace-dir → kumiko.runtime. Owned by the script so a
// single ts-morph scan amortizes the workspace lookup across thousands
// of files.
const workspaceCache = new Map<string, Runtime | null>();

const project = new Project({
  tsConfigFilePath: path.join(REPO_ROOT, "packages/framework/tsconfig.json"),
});
project.addSourceFilesAtPaths([
  "packages/**/*.ts",
  "packages/**/*.tsx",
  "samples/**/*.ts",
  "samples/**/*.tsx",
  "bin/**/*.ts",
  "scripts/**/*.ts",
  "!**/node_modules/**",
  "!**/dist/**",
]);

type Violation = {
  file: string;
  line: number;
  fileRuntime: Runtime;
  importedSpec: string;
  importedFile: string;
  importedRuntime: Runtime;
};

const violations: Violation[] = [];
const stats: Record<Runtime, number> = {
  runtime: 0,
  client: 0,
  dev: 0,
  tooling: 0,
  test: 0,
};

for (const sf of project.getSourceFiles()) {
  const fp = sf.getFilePath();
  if (fp.includes("/node_modules/") || fp.includes("/dist/")) continue;
  const fileRt = classify(fp, REPO_ROOT, workspaceCache);
  stats[fileRt]++;

  for (const decl of sf.getImportDeclarations()) {
    const target = decl.getModuleSpecifierSourceFile();
    if (!target) continue;
    const targetPath = target.getFilePath();
    if (targetPath.includes("/node_modules/")) continue;
    const targetRt = classify(targetPath, REPO_ROOT, workspaceCache);

    // Type-only imports tragen mit verbatimModuleSyntax keine Runtime-Last —
    // werden beim Emit komplett gestrippt. Skippen.
    if (decl.isTypeOnly()) continue;
    const named = decl.getNamedImports();
    if (named.length > 0 && named.every((n) => n.isTypeOnly())) {
      // alle named imports sind type-only, default-import auch keiner
      if (!decl.getDefaultImport() && !decl.getNamespaceImport()) continue;
    }

    if (!COMPAT[fileRt].has(targetRt)) {
      violations.push({
        file: fp,
        line: decl.getStartLineNumber(),
        fileRuntime: fileRt,
        importedSpec: decl.getModuleSpecifierValue(),
        importedFile: targetPath,
        importedRuntime: targetRt,
      });
    }
  }
}

const wantJson = process.argv.includes("--json");

if (wantJson) {
  console.log(JSON.stringify({ stats, violations }, null, 2));
} else {
  console.log("[runtime-isolation] file stats:");
  for (const [rt, n] of Object.entries(stats)) {
    console.log(`  ${rt.padEnd(8)} ${n} files`);
  }
  if (violations.length === 0) {
    console.log("\n[runtime-isolation] OK — no cross-runtime violations");
  } else {
    console.log(`\n[runtime-isolation] ${violations.length} violations:\n`);
    for (const v of violations) {
      const fileRel = path.relative(REPO_ROOT, v.file);
      const targetRel = path.relative(REPO_ROOT, v.importedFile);
      console.log(`  ${fileRel}:${v.line}`);
      console.log(`    [${v.fileRuntime}] imports [${v.importedRuntime}] "${v.importedSpec}"`);
      console.log(`    → ${targetRel}`);
    }
  }
}

process.exit(violations.length > 0 ? 1 : 0);

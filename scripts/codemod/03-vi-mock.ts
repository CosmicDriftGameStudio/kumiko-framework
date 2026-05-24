#!/usr/bin/env bun
// Codemod 03: vi.mock → mock.module mit Hoisting-Check
//
// Wichtig: vi.mock wird in vitest AUTOMATISCH gehoist (über alle Top-Level-
// Statements + Imports). bun:test's mock.module hoistet NICHT. Wenn vi.mock
// in der Mitte einer Test-Datei steht und davor schon module-Verwendung
// passiert, ändert sich Semantik beim Drop-in-Rename.
//
// Diese Codemod:
//   1. Findet alle vi.mock(...) Calls
//   2. Prüft ob das ERSTE Statement nach Imports ist (sicher)
//   3. Wenn ja: rename → mock.module
//   4. Wenn nein: warn-listen, manueller Review nötig
//
// Spezialfall: vi.mock mit factory die vi.importActual nutzt →
// kompletter Pattern-Rewrite. Wegen Komplexität: warn-listen für manual.

import { Project, SyntaxKind, type SourceFile, type CallExpression, Node } from "ts-morph";
import { resolve } from "node:path";

const PROJECT_ROOT = process.argv[2] ?? process.cwd();
const TS_CONFIG = resolve(PROJECT_ROOT, "tsconfig.json");

type Verdict =
  | { kind: "safe-rename"; call: CallExpression }
  | { kind: "warn-hoisting"; call: CallExpression; reason: string }
  | { kind: "warn-importactual"; call: CallExpression }
  | { kind: "warn-hoisted-vars"; call: CallExpression };

function analyzeViMock(sf: SourceFile, call: CallExpression): Verdict {
  // Ist die Call-Expression in einem ExpressionStatement das auf Top-Level liegt?
  const stmt = call.getFirstAncestorByKind(SyntaxKind.ExpressionStatement);
  if (!stmt) return { kind: "warn-hoisting", call, reason: "not in ExpressionStatement" };

  const parent = stmt.getParent();
  if (!parent || !Node.isSourceFile(parent)) {
    return { kind: "warn-hoisting", call, reason: "vi.mock not at top-level (nested in block/function)" };
  }

  // Prüfe ob vi.importActual in der factory referenziert ist
  // (komplexes Pattern, manual review besser)
  const callText = call.getText();
  if (callText.includes("vi.importActual")) {
    return { kind: "warn-importactual", call };
  }

  // Prüfe ob vi.hoisted in derselben Datei steht
  if (sf.getFullText().includes("vi.hoisted(")) {
    return { kind: "warn-hoisted-vars", call };
  }

  // Position: stmt sollte VOR allen non-import-statements stehen
  const stmtIdx = sf.getStatements().indexOf(stmt);
  if (stmtIdx === -1) return { kind: "warn-hoisting", call, reason: "stmt not in source statements" };

  // Alle Statements VOR diesem stmt dürfen nur ImportDeclarations sein
  for (let i = 0; i < stmtIdx; i++) {
    const earlier = sf.getStatements()[i];
    if (!earlier) continue;
    if (Node.isImportDeclaration(earlier)) continue;
    return {
      kind: "warn-hoisting",
      call,
      reason: `vi.mock at idx ${stmtIdx} but stmt at idx ${i} is ${earlier.getKindName()}`,
    };
  }

  return { kind: "safe-rename", call };
}

async function main(): Promise<void> {
  console.log(`[codemod 03-vi-mock] project: ${PROJECT_ROOT}`);
  const project = new Project({ tsConfigFilePath: TS_CONFIG });

  const sourceFiles = project.getSourceFiles([
    "**/*.test.ts",
    "**/*.test.tsx",
    "**/*.integration.ts",
  ]);

  let renamed = 0;
  const warnings: string[] = [];

  for (const sf of sourceFiles) {
    const path = sf.getFilePath();
    if (path.includes("/node_modules/") || path.includes("/dist/")) continue;

    const viMockCalls = sf
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .filter((c) => c.getExpression().getText() === "vi.mock");

    if (viMockCalls.length === 0) continue;

    let touched = false;
    for (const call of viMockCalls) {
      const verdict = analyzeViMock(sf, call);
      switch (verdict.kind) {
        case "safe-rename":
          call.getExpression().replaceWithText("mock.module");
          renamed++;
          touched = true;
          break;
        case "warn-hoisting":
          warnings.push(`HOISTING: ${path}:${call.getStartLineNumber()} — ${verdict.reason}`);
          break;
        case "warn-importactual":
          warnings.push(
            `IMPORTACTUAL: ${path}:${call.getStartLineNumber()} — vi.mock with vi.importActual: rewrite as 3-statement-form (mock + await import + mock.module)`,
          );
          break;
        case "warn-hoisted-vars":
          warnings.push(
            `HOISTED-VARS: ${path}:${call.getStartLineNumber()} — vi.hoisted used in same file, manual review for execution-order`,
          );
          break;
      }
    }

    if (touched) sf.saveSync();
  }

  console.log(`[codemod 03-vi-mock] safe-renamed ${renamed} call(s)`);

  if (warnings.length) {
    console.log(`[codemod 03-vi-mock] WARNINGS — ${warnings.length} require manual review:`);
    for (const w of warnings) console.log(`  ${w}`);
    console.log(``);
    console.log(`Manual-review pattern for vi.hoisted + vi.importActual:`);
    console.log(`  // VORHER:`);
    console.log(`  // const { mockFn } = vi.hoisted(() => ({ mockFn: vi.fn() }));`);
    console.log(`  // vi.mock(path, async () => {`);
    console.log(`  //   const actual = await vi.importActual(path);`);
    console.log(`  //   return { ...actual, foo: mockFn };`);
    console.log(`  // });`);
    console.log(``);
    console.log(`  // NACHHER:`);
    console.log(`  // const mockFn = mock(() => undefined);`);
    console.log(`  // const actual = await import(path);`);
    console.log(`  // mock.module(path, () => ({ ...actual, foo: mockFn }));`);
  }
}

await main();

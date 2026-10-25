#!/usr/bin/env bun
// Codemod 03: vi.mock → mock.module with hoisting check
//
// Important: vi.mock is AUTOMATICALLY hoisted (across all top-level-
// statements + imports). bun:test's mock.module does NOT hoist. If vi.mock
// is in the middle of a test file and module usage has already happened
// before it, semantics change with the drop-in rename.
//
// This codemod:
//   1. Finds all vi.mock(...) calls
//   2. Checks whether it is the FIRST statement after imports (safe)
//   3. If yes: rename → mock.module
//   4. If no: add to warning list, manual review needed
//
// Special case: vi.mock with a factory that uses vi.importActual →
// complete pattern rewrite. Due to complexity: add to warning list for manual review.

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
  // Is the call expression in an ExpressionStatement that is at top level?
  const stmt = call.getFirstAncestorByKind(SyntaxKind.ExpressionStatement);
  if (!stmt) return { kind: "warn-hoisting", call, reason: "not in ExpressionStatement" };

  const parent = stmt.getParent();
  if (!parent || !Node.isSourceFile(parent)) {
    return { kind: "warn-hoisting", call, reason: "vi.mock not at top-level (nested in block/function)" };
  }

  // Check whether vi.importActual is referenced in the factory
  // (complex pattern, manual review is better)
  const callText = call.getText();
  if (callText.includes("vi.importActual")) {
    return { kind: "warn-importactual", call };
  }

  // Check whether vi.hoisted is present in the same file
  if (sf.getFullText().includes("vi.hoisted(")) {
    return { kind: "warn-hoisted-vars", call };
  }

  // Position: stmt should come BEFORE all non-import-statements
  const stmtIdx = sf.getStatements().indexOf(stmt);
  if (stmtIdx === -1) return { kind: "warn-hoisting", call, reason: "stmt not in source statements" };

  // All statements BEFORE this stmt may only be ImportDeclarations
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

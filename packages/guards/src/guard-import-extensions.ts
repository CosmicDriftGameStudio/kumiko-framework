#!/usr/bin/env bun
/**
 * Guard: relative imports in TypeScript sources name the source file (`./foo.ts`),
 * not the emitted one (`./foo.js`).
 *
 * The tsconfig sets `allowImportingTsExtensions` and `rewriteRelativeImportExtensions`, so tsc
 * writes `.js` into the published dist. A `.js` specifier in a source file works under bundler
 * resolution, but it makes the source tree read two ways and hides missing files from editors
 * that jump to the importee.
 *
 * Usage:
 *   bun guards/guard-import-extensions.ts
 *
 * Exit 1 on violations, 0 when clean.
 */

import { type Node, type SourceFile, SyntaxKind } from "ts-morph";
import { type AstGuard, runStandalone, type ScanSpec } from "./_lib/guard-kit";

const SCAN: ScanSpec = {
  scope: "source+tests",
  extensions: ["ts", "tsx"],
};

const EXCLUDE = /(\.d\.ts$|\/fixtures\/)/;
const RELATIVE_JS_SPECIFIER = /^\.{1,2}\/.*\.jsx?$/;

interface Finding {
  readonly line: number;
  readonly specifier: string;
}

function relativeJsSpecifier(node: Node | undefined): string | undefined {
  const literal = node?.asKind(SyntaxKind.StringLiteral);
  const value = literal?.getLiteralValue();
  return value !== undefined && RELATIVE_JS_SPECIFIER.test(value) ? value : undefined;
}

function findJsSpecifiers(sf: SourceFile): Finding[] {
  const findings: Finding[] = [];
  const add = (node: Node | undefined): void => {
    const specifier = relativeJsSpecifier(node);
    if (node !== undefined && specifier !== undefined) {
      findings.push({ line: node.getStartLineNumber(), specifier });
    }
  };
  for (const declaration of [...sf.getImportDeclarations(), ...sf.getExportDeclarations()]) {
    add(declaration.getModuleSpecifier());
  }
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getKind() === SyntaxKind.ImportKeyword) add(call.getArguments()[0]);
  }
  return findings;
}

export const guard: AstGuard = {
  name: "Import-Extensions Guard",
  scan: SCAN,
  hint:
    "Relative imports name the source file: `./foo.js` -> `./foo.ts`, `./Comp.jsx` -> `./Comp.tsx`. " +
    "Run the import-extensions codemod: `bun node_modules/@cosmicdrift/kumiko-framework/src/scripts/codemod/import-extensions.ts . --write`. " +
    "The tsconfig needs `allowImportingTsExtensions` (and `rewriteRelativeImportExtensions` when tsc emits).",
  run(files) {
    const violations: Array<{ file: string; line: number; message: string }> = [];
    for (const sf of files) {
      const file = sf.getFilePath();
      if (EXCLUDE.test(file)) continue;
      for (const { line, specifier } of findJsSpecifiers(sf)) {
        violations.push({
          file,
          line,
          message: `relative import "${specifier}" ends in .js/.jsx; use the .ts/.tsx source (codemod: import-extensions)`,
        });
      }
    }
    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);

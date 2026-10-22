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

import { dirname, resolve } from "node:path";
import { type Node, type SourceFile, SyntaxKind } from "ts-morph";
import { type AstGuard, runStandalone, type ScanSpec } from "./_lib/guard-kit";

const SCAN: ScanSpec = {
  scope: "source+tests",
  extensions: ["ts", "tsx"],
};

const EXCLUDE = /(\.d\.ts$|\/fixtures\/)/;
const RELATIVE_JS_SPECIFIER = /^(\.{1,2}\/.*)\.(jsx?)$/;
// A published bin that imports its own build output (`../dist/cli.js`) has no
// `.ts` sibling to name; the `.js` there is the only file that exists.
const BUILD_OUTPUT_SEGMENT = /(^|\/)dist\//;

interface Finding {
  readonly line: number;
  readonly specifier: string;
}

// Mirrors the import-extensions codemod: only a specifier with a `.ts`/`.tsx` sibling is fixable.
// A genuine `.js` file (generated or vendored) has nothing to rename to and must not fail the guard.
function hasSourceSibling(sf: SourceFile, base: string, extension: string): boolean {
  const candidates = extension === "jsx" ? ["tsx"] : ["ts", "tsx"];
  const project = sf.getProject();
  return candidates.some((candidate) => {
    const path = resolve(dirname(sf.getFilePath()), `${base}.${candidate}`);
    return (
      project.getSourceFile(path) !== undefined || project.getFileSystem().fileExistsSync(path)
    );
  });
}

function relativeJsSpecifier(sf: SourceFile, node: Node | undefined): string | undefined {
  const literal = node?.asKind(SyntaxKind.StringLiteral);
  const value = literal?.getLiteralValue();
  if (value === undefined || BUILD_OUTPUT_SEGMENT.test(value)) return undefined;
  const [, base = "", extension = ""] = RELATIVE_JS_SPECIFIER.exec(value) ?? [];
  if (base === "" || !hasSourceSibling(sf, base, extension)) return undefined;
  return value;
}

function findJsSpecifiers(sf: SourceFile): Finding[] {
  const findings: Finding[] = [];
  const add = (node: Node | undefined): void => {
    const specifier = relativeJsSpecifier(sf, node);
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

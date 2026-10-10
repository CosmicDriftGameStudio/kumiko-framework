#!/usr/bin/env bun
// lib/ is the home of extracted logic (computation, parsing, mapping) —
// the no-logic-in-views guard pushes it there, this guard ensures it is also
// TESTED at the new location. For every lib file with at least one exported
// function, a test must exist that imports from the module, and every
// exported function must appear there by name.
//
// Why static (ts-morph) instead of a coverage threshold: coverage lies twice —
// it does not see never-imported modules at all, and "executed" does not mean
// "meaningfully tested" (an integration test that touches the function
// transitively over HTTP turns it green without a single assertion on its
// behavior). This guard is the structural counterpart: it couples test↔module
// through the real import and counts references by name, not lines. The
// coverage threshold in bunfig.toml stays in place alongside — both together,
// never the threshold alone.
//
// Excluded: files without an exported function (pure types/constants like
// a color map — a test for those would be a fake test). IO loaders already
// covered by an integration test over HTTP carry the ignore tag with a
// truthful justification.
//
// Deliberately out of scope: re-exports (`export { foo } from "./bar"`) do not
// count as their own callable — the source file "./bar" carries its own
// coverage duty. If lib/ ever contains re-exported functions without their own
// source file in scope, that is a silent blind spot; so far (as of this fix
// round) the pattern occurs in no app repo.

import { dirname, resolve } from "node:path";
import { Node, type SourceFile, SyntaxKind } from "ts-morph";
import { type AstGuard, type GuardViolation, runStandalone, type ScanSpec } from "./_lib/guard-kit";
import { escapeRegExp } from "./_lib/handler-name-forms";
import { hasIgnoreTag } from "./_lib/ignore-tag";

// isTestFile() classifies by regex on the file's own path, not by which within-glob matched it, so lib/ vs. test classification stays correct regardless of scan-scope resolution.
const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts", "tsx"],
  kinds: ["library", "app"],
  within: ["lib/**/*.{ts,tsx}", "**/lib/**/*.{ts,tsx}", "**/*.test.ts", "**/*.test.tsx"],
};
const IGNORE_TAG = "kumiko-lint-ignore lib-test-coverage";

type Export = { readonly name: string; readonly node: Node };

function isTestFile(path: string): boolean {
  return /\.test\.tsx?$/.test(path);
}

// Fixtures/helpers under __tests__/ without a .test. suffix are neither tests
// (they must not satisfy the coverage link) nor lib sources (no test duty).
function isTestSupportFile(path: string): boolean {
  return /\/__tests__\//.test(path);
}

// Exported callables: `export function f` and `export const f = () => …` /
// `= function () {}`. Pure values (`export const X = 5`), types and interfaces
// do not count — they carry no logic a behavior test could check.
function exportedCallables(sf: SourceFile): Export[] {
  const out: Export[] = [];
  for (const fd of sf.getFunctions()) {
    const name = fd.getName();
    if (name !== undefined && (fd.isExported() || fd.isDefaultExport()))
      out.push({ name, node: fd });
  }
  for (const vs of sf.getVariableStatements()) {
    if (!vs.isExported()) continue;
    for (const decl of vs.getDeclarations()) {
      const init = decl.getInitializer();
      if (init !== undefined && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
        out.push({ name: decl.getName(), node: decl });
      }
    }
  }
  return out;
}

// NodeNext-Importe schreiben ".js"/".jsx", obwohl die Quelle ".ts"/".tsx" ist
// (and likewise .mjs/.cjs for .mts/.cts) — the extension must therefore be
// stripped for all four pair variants when comparing module paths, otherwise
// the link breaks.
function stripExt(path: string): string {
  return path.replace(/\.(?:[cm]?tsx?|[cm]?jsx?)$/, "");
}

// A test is linked to a lib file when it imports from exactly that file by
// relative path — not by path convention. This allows tests one level above
// lib/ (features/<x>/__tests__/foo.test.ts → "../lib/foo") and prevents
// generic names (fieldText, targetForRow) in unrelated tests from wrongly
// counting as a reference.
function testImportsLib(testSf: SourceFile, libPathNoExt: string): boolean {
  const testDir = dirname(testSf.getFilePath());
  for (const imp of testSf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue();
    if (!spec.startsWith(".")) continue;
    if (stripExt(resolve(testDir, spec)) === libPathNoExt) return true;
  }
  return false;
}

// Exclude import declarations: a named import without any usage
// (`import { addFees, subFees } from "../calc"`, only addFees called)
// used to satisfy the guard for subFees through the import text alone —
// the per-function check was nearly tautological for named imports.
function bodyTextWithoutImports(testSf: SourceFile): string {
  const importRanges = testSf
    .getDescendantsOfKind(SyntaxKind.ImportDeclaration)
    .map((d) => [d.getStart(), d.getEnd()] as const);
  const full = testSf.getFullText();
  let out = "";
  let cursor = 0;
  for (const [start, end] of importRanges) {
    out += full.slice(cursor, start);
    cursor = end;
  }
  out += full.slice(cursor);
  return out;
}

function referencesName(testSf: SourceFile, name: string): boolean {
  // `\b` does not treat `$` as a word character, so identifiers like `format$`
  // need explicit identifier-char lookarounds.
  return new RegExp(`(?<![\\w$])${escapeRegExp(name)}(?![\\w$])`).test(
    bodyTextWithoutImports(testSf),
  );
}

export const guard: AstGuard = {
  name: "Lib-Test-Coverage Guard (App-Repos)",
  scan: SCAN,
  hint:
    "Every lib file with an exported function needs a test that imports from the " +
    "module and references each function by name. IO loaders that an " +
    `integration test covers: // ${IGNORE_TAG} <reason, e.g. integration-covered via …>`,
  run(files: readonly SourceFile[]) {
    const violations: GuardViolation[] = [];
    const testFiles: SourceFile[] = [];
    const libFiles: SourceFile[] = [];
    for (const sf of files) {
      if (isTestFile(sf.getFilePath())) testFiles.push(sf);
      else if (!sf.getFilePath().endsWith(".d.ts") && !isTestSupportFile(sf.getFilePath()))
        libFiles.push(sf);
    }
    for (const sf of libFiles) {
      const relevant = exportedCallables(sf).filter((e) => !hasIgnoreTag(e.node, IGNORE_TAG));
      if (relevant.length === 0) continue;

      const libPathNoExt = stripExt(sf.getFilePath());
      const linked = testFiles.filter((t) => testImportsLib(t, libPathNoExt));
      if (linked.length === 0) {
        violations.push({
          file: sf.getFilePath(),
          line: 1,
          message: `No test imports this lib module (${relevant.length} exported function(s) untested)`,
        });
        continue;
      }

      for (const e of relevant) {
        if (linked.some((t) => referencesName(t, e.name))) continue;
        violations.push({
          file: sf.getFilePath(),
          line: e.node.getStartLineNumber(),
          message: `Exported function "${e.name}" is not referenced by name in any linked test`,
        });
      }
    }
    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);

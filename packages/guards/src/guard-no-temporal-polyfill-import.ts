#!/usr/bin/env bun
/**
 * Guard: finds value imports from `temporal-polyfill` outside kumiko-types.
 *
 * Since 0.351.0 `@cosmicdrift/kumiko-types/temporal` is the single source of
 * the Temporal API: native `globalThis.Temporal` wins, the polyfill is only a
 * fallback. A module that imports `Temporal` straight from `temporal-polyfill`
 * gets the polyfill classes while framework-made values are native ones, so
 * `instanceof Temporal.Instant` and `z.instanceof(Temporal.Instant)` reject
 * them ("expected Instant, received Instant"). Side-effect imports such as
 * `temporal-polyfill/global` are flagged too: they can put a second
 * implementation on the global.
 *
 * Not flagged: `import type` (erased at runtime) and the
 * `/// <reference types="temporal-polyfill/global" />` directive.
 *
 * Usage:
 *   bun guards/guard-no-temporal-polyfill-import.ts
 *
 * Exit 1 on violations, 0 when clean.
 */

import { type ImportDeclaration, Node, type SourceFile, SyntaxKind } from "ts-morph";
import {
  type AstGuard,
  findRepoRootFor,
  type GuardViolation,
  relFromRepoRoot,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";
import { type RepoRoot, resolveRepoRoots } from "./_lib/roots";

const SCAN: ScanSpec = {
  scope: "source+tests",
  extensions: ["ts", "tsx"],
  frameworkWithin: ["packages/*/src/**", "samples/**"],
};

const REPLACEMENT_IMPORT = 'import { Temporal } from "@cosmicdrift/kumiko-types/temporal";';

// The one module that resolves native-vs-polyfill; repo-scoped so an app file
// at the same relative path does not inherit the exception.
const TEMPORAL_SOURCE = { repo: "kumiko-framework", relPath: "packages/types/src/temporal.ts" };

export function isTemporalSingleSource(repoName: string | undefined, relPath: string): boolean {
  return repoName === TEMPORAL_SOURCE.repo && relPath === TEMPORAL_SOURCE.relPath;
}

function isPolyfillSpecifier(specifier: string): boolean {
  return specifier === "temporal-polyfill" || specifier.startsWith("temporal-polyfill/");
}

function isTypeOnlyImport(decl: ImportDeclaration): boolean {
  if (decl.isTypeOnly()) return true;
  const named = decl.getNamedImports();
  const hasValueBinding =
    decl.getDefaultImport() !== undefined || decl.getNamespaceImport() !== undefined;
  return !hasValueBinding && named.length > 0 && named.every((n) => n.isTypeOnly());
}

type PolyfillImport = { readonly line: number; readonly specifier: string };

function findPolyfillValueImports(sf: SourceFile): PolyfillImport[] {
  const found: PolyfillImport[] = [];
  for (const decl of sf.getImportDeclarations()) {
    const specifier = decl.getModuleSpecifierValue();
    if (isPolyfillSpecifier(specifier) && !isTypeOnlyImport(decl)) {
      found.push({ line: decl.getStartLineNumber(), specifier });
    }
  }
  for (const decl of sf.getExportDeclarations()) {
    const specifier = decl.getModuleSpecifierValue();
    if (specifier !== undefined && isPolyfillSpecifier(specifier) && !decl.isTypeOnly()) {
      found.push({ line: decl.getStartLineNumber(), specifier });
    }
  }
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    const isRequireCall = Node.isIdentifier(callee) && callee.getText() === "require";
    const isDynamicImport = callee.getKind() === SyntaxKind.ImportKeyword;
    if (!isRequireCall && !isDynamicImport) continue;
    const arg = call.getArguments()[0];
    if (arg && Node.isStringLiteral(arg) && isPolyfillSpecifier(arg.getLiteralValue())) {
      found.push({ line: call.getStartLineNumber(), specifier: arg.getLiteralValue() });
    }
  }
  return found;
}

export const guard: AstGuard = {
  name: "No-Temporal-Polyfill-Import Guard",
  scan: SCAN,
  hint: `Import Temporal from the kumiko single source instead: ${REPLACEMENT_IMPORT} A direct "temporal-polyfill" import creates a second Temporal implementation, so instanceof and z.instanceof(Temporal.Instant) reject framework-made values.`,
  run(files, roots: readonly RepoRoot[] = resolveRepoRoots()) {
    const violations: GuardViolation[] = [];
    for (const sf of files) {
      const file = sf.getFilePath();
      const rel = relFromRepoRoot(file, roots);
      if (isTemporalSingleSource(findRepoRootFor(file, roots)?.name, rel)) continue;
      for (const hit of findPolyfillValueImports(sf)) {
        violations.push({
          file: rel,
          line: hit.line,
          message: `[${hit.specifier}] direct temporal-polyfill import — use ${REPLACEMENT_IMPORT}`,
        });
      }
    }
    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);

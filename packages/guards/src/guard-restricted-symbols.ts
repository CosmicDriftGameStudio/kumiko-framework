#!/usr/bin/env bun
/**
 * Guard: finds imports/re-exports of the unscoped stream primitives outside
 * an allowlist.
 *
 * `getUnscopedAggregateStreamMaxVersion` / `getUnscopedAggregateStreamTenant`
 * (packages/framework/src/event-store/event-store.ts) have no tenant
 * filter — they are an existence oracle for foreign tenants (see
 * kumiko-framework#1269). Legitimate only for seed-/system-internal code
 * that deliberately works across tenants.
 *
 * Usage:
 *   bun guards/guard-restricted-symbols.ts
 *
 * Exit 1 on violations in non-allowlisted files, 0 when clean.
 */

import { type SourceFile, SyntaxKind } from "ts-morph";
import {
  type AstGuard,
  isAllowlisted,
  relFromRepoRoot,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";
import { resolveRepoRoots } from "./_lib/roots";

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts"],
  frameworkWithin: ["packages/*/src/**", "samples/**"],
};

const EXCLUDE = /(__tests__|\.test\.ts$|\.integration\.ts$|\.d\.ts$)/;

const RESTRICTED_SYMBOLS = new Set([
  "getUnscopedAggregateStreamMaxVersion",
  "getUnscopedAggregateStreamTenant",
]);

const ALLOWLIST = [
  /^packages\/framework\/src\/event-store\/event-store\.ts$/,
  /^packages\/framework\/src\/event-store\/index\.ts$/,
  /^packages\/bundled-features\/src\/tenant\/seeding\.ts$/,
  /^packages\/bundled-features\/src\/tier-engine\/feature\.ts$/,
];

interface Violation {
  line: number;
  symbol: string;
}

// Namespace import (`import * as es from "...event-store"; es.getUnscoped...()`)
// doesn't bind a named import declaration, so it slips past
// findRestrictedSymbolReferences() below — catch `<namespace>.<restrictedSymbol>`
// property access instead. `export *` re-exports remain an unaddressed gap
// (see the guard's `hint` for the known limitation).
function findNamespacedSymbolAccesses(sf: SourceFile): Violation[] {
  const violations: Violation[] = [];

  const namespaceNames = new Set(
    sf
      .getImportDeclarations()
      .map((d) => d.getNamespaceImport())
      .filter((ns): ns is NonNullable<typeof ns> => ns !== undefined)
      .map((ns) => ns.getText()),
  );
  if (namespaceNames.size === 0) return violations;

  for (const access of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    const objText = access.getExpression().getText();
    const propName = access.getNameNode().getText();
    if (namespaceNames.has(objText) && RESTRICTED_SYMBOLS.has(propName)) {
      violations.push({ line: access.getStartLineNumber(), symbol: propName });
    }
  }

  return violations;
}

// Named imports (`import { X } from ...`) and re-exports (`export { X } from
// ...`) both cross a module boundary — either shape counts as an unguarded
// reference. getName() returns the imported/exported symbol's original name,
// not a local alias, so `as`-renamed references are still caught.
function findRestrictedSymbolReferences(sf: SourceFile): Violation[] {
  const violations: Violation[] = [];

  for (const importDecl of sf.getImportDeclarations()) {
    for (const named of importDecl.getNamedImports()) {
      const name = named.getName();
      if (RESTRICTED_SYMBOLS.has(name)) {
        violations.push({ line: named.getStartLineNumber(), symbol: name });
      }
    }
  }

  for (const exportDecl of sf.getExportDeclarations()) {
    if (!exportDecl.getModuleSpecifier()) continue;
    for (const named of exportDecl.getNamedExports()) {
      const name = named.getName();
      if (RESTRICTED_SYMBOLS.has(name)) {
        violations.push({ line: named.getStartLineNumber(), symbol: name });
      }
    }
  }

  violations.push(...findNamespacedSymbolAccesses(sf));

  return violations;
}

export const guard: AstGuard = {
  name: "Restricted-Symbols Guard",
  scan: SCAN,
  hint: 'getUnscopedAggregateStream{MaxVersion,Tenant} is an existence oracle for foreign tenants — only seed-/system-internal code may reference them. New caller needed? Extend the allowlist in guard-restricted-symbols.ts, with a reason. Known gap: `export * from "...event-store"` is not detected (named imports, re-exports, and namespace property access are covered).',
  run(files) {
    const violations: Array<{ file: string; line: number; message: string }> = [];
    const roots = resolveRepoRoots();

    for (const sf of files) {
      const file = sf.getFilePath();
      const rel = relFromRepoRoot(file, roots);
      if (EXCLUDE.test(rel)) continue;
      if (isAllowlisted(rel, ALLOWLIST)) continue;
      for (const v of findRestrictedSymbolReferences(sf)) {
        violations.push({
          file: rel,
          line: v.line,
          message: `[${v.symbol}] unscoped stream-primitive referenced outside allowlist`,
        });
      }
    }

    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);

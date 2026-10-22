#!/usr/bin/env bun
/**
 * Guard: finds imports/re-exports of the unscoped stream primitives outside
 * an allowlist.
 *
 * `getUnscopedAggregateStreamMaxVersion` / `getUnscopedAggregateStreamTenant`
 * (packages/framework/src/event-store/event-store.ts) have no tenant
 * filter — they are an existence oracle for foreign tenants. Legitimate only
 * for seed-/system-internal code that deliberately works across tenants.
 *
 * Usage:
 *   bun guards/guard-restricted-symbols.ts
 *
 * Exit 1 on violations in non-allowlisted files, 0 when clean.
 */

import { type SourceFile, SyntaxKind } from "ts-morph";
import {
  ALL_REPO_KINDS,
  type AstGuard,
  isAllowlisted,
  relFromRepoRoot,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";
import { resolveRepoRoots } from "./_lib/roots";

const SCAN: ScanSpec = {
  kinds: ALL_REPO_KINDS,
  scope: "source",
  extensions: ["ts"],
  frameworkWithin: ["packages/*/src/**", "samples/**"],
};

const EXCLUDE = /(__tests__|\.test\.ts$|\.integration\.ts$|\.d\.ts$)/;

const RESTRICTED_SYMBOLS = new Set([
  "getUnscopedAggregateStreamMaxVersion",
  "getUnscopedAggregateStreamTenant",
  // Appends any event type without the feature-ownership check of ctx.appendEvent and without
  // an audited unsafeRaw escape hatch, so new callers need an explicit allowlist entry.
  "appendEventInTenantDb",
  "getStreamVersionInTenantDb",
  // Grants the ES-write capability on the tenant being destroyed; only the destroy stage and its definition may use it.
  "createTenantDataDestroyDb",
  // Test seam that writes event-fed tables without events; runtime code importing it would be a back door.
  "withExecutorManagedWritesForTests",
]);

const ALLOWLIST = [
  /^packages\/framework\/src\/event-store\/event-store\.ts$/,
  /^packages\/framework\/src\/event-store\/index\.ts$/,
  /^packages\/framework\/src\/event-store\/tenant-db-append\.ts$/,
  /^packages\/bundled-features\/src\/cap-counter\/cap-reservation\.ts$/,
  // Catch-up of a missing terminal extract event in the caller tenant's own stream; JobContext has no appendEvent.
  /^packages\/bundled-features\/src\/document-ingest-foundation\/append-missing-extract-event\.ts$/,
  /^packages\/bundled-features\/src\/user-data-rights-defaults\/hooks\/delivery-attempt\.userdata-hook\.ts$/,
  /^packages\/framework\/src\/db\/tenant-db\.ts$/,
  /^packages\/framework\/src\/db\/index\.ts$/,
  /^packages\/bundled-features\/src\/tenant-lifecycle\/stages\.ts$/,
  /^packages\/testing\/src\/helpers\/(seed|db-cleanup)\.ts$/,
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
  hint: 'getUnscopedAggregateStream{MaxVersion,Tenant} is an existence oracle for foreign tenants — only seed-/system-internal code may reference them. appendEventInTenantDb/getStreamVersionInTenantDb bypass the feature-ownership check of ctx.appendEvent — only framework-internal coordination code may use them. createTenantDataDestroyDb grants direct writes on event-fed tables and belongs to the tenant-destroy stage only. withExecutorManagedWritesForTests is the test-seed seam behind seedRow/deleteRows and must not reach runtime code. New caller needed? Extend the allowlist in guard-restricted-symbols.ts, with a reason. Known gap: `export * from "...event-store"` is not detected (named imports, re-exports, and namespace property access are covered).',
  run(files, roots = resolveRepoRoots()) {
    const violations: Array<{ file: string; line: number; message: string }> = [];

    for (const sf of files) {
      const file = sf.getFilePath();
      const rel = relFromRepoRoot(file, roots);
      if (EXCLUDE.test(rel)) continue;
      if (isAllowlisted(rel, ALLOWLIST)) continue;
      for (const v of findRestrictedSymbolReferences(sf)) {
        violations.push({
          file: rel,
          line: v.line,
          message: `[${v.symbol}] restricted event-store primitive referenced outside allowlist`,
        });
      }
    }

    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);

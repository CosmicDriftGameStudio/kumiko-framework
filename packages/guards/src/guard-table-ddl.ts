#!/usr/bin/env bun
/**
 * Table-DDL Guard (WARNING, no fail).
 *
 * Finds calls of `unsafePushTables` / `unsafeCreateEntityTable` /
 * `unsafeEnsureEntityTable` outside the allowed paths. Apps
 * declare tables via `r.entity()` (event-sourced) or
 * `r.rawTable()` (declarative bypass with audit marker) — direct
 * `unsafe*` calls bypass the event-sourcing system entirely.
 *
 * Plan: kumiko-platform/docs/plans/architecture/table-ddl-guard.md
 * (stage 2). Stage 1 renamed the symbols so every call is
 * greppable; stage 3 introduced `r.rawTable()` as the clean alternative;
 * stage 2 (this check) enforces consistency.
 *
 * Allowlist (path regexes, OR-combined):
 *   - packages/framework/src/event-store/**          ES meta tables
 *   - packages/framework/src/pipeline/event-consumer-state.ts
 *   - packages/framework/src/pipeline/projection-state.ts
 *   - packages/framework/src/stack/**                test-stack helpers, pushEntityProjectionTables, helper definitions
 *   - **\/__tests__/**                               test setup
 *   - **\/drizzle/**                                 drizzle-kit configuration
 *   - **\/bin/migrate.ts                             app-owned migrate CLI
 *   - packages/guards/src/guard-table-ddl.ts          the guard itself
 *   - kumiko-framework/scripts/migrate-rename-table-ddl.ts  ts-morph rename
 *
 * Output: warning + file:line + code snippet. Never blocks.
 */

import path from "node:path";
import { type SourceFile, SyntaxKind } from "ts-morph";
import { type AstGuard, runStandalone, type ScanSpec } from "./_lib/guard-kit";

const ROOT = process.cwd();

const SCAN: ScanSpec = { scope: "source", extensions: ["ts"] };

export const UNSAFE_NAMES: ReadonlySet<string> = new Set([
  "unsafePushTables",
  "unsafeCreateEntityTable",
  "unsafeEnsureEntityTable",
]);

export const ALLOWLIST_PATTERNS: ReadonlyArray<RegExp> = [
  /\/packages\/framework\/src\/event-store\//,
  /\/packages\/framework\/src\/pipeline\/event-consumer-state\.ts$/,
  /\/packages\/framework\/src\/pipeline\/projection-state\.ts$/,
  /\/packages\/framework\/src\/stack\//,
  /\/__tests__\//,
  /\/drizzle\//,
  /\/bin\/migrate\.ts$/,
  // Guards + the rename script may name the symbols in code — both are
  // tooling, not a runtime path.
  /\/packages\/guards\/src\/guard-table-ddl\.ts$/,
  /\/scripts\/migrate-rename-table-ddl\.ts$/,
];

export function isAllowed(absPath: string): boolean {
  return ALLOWLIST_PATTERNS.some((re) => re.test(absPath));
}

export interface Finding {
  readonly file: string;
  readonly line: number;
  readonly symbol: string;
  readonly snippet: string;
}

export function collectFindings(sf: SourceFile, repoRoot: string): Finding[] {
  const absPath = sf.getFilePath();
  if (isAllowed(absPath)) return [];

  const findings: Finding[] = [];
  const lines = sf.getFullText().split("\n");

  for (const id of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const name = id.getText();
    if (!UNSAFE_NAMES.has(name)) continue;

    // Skip the import/export specifier itself — the violation is the
    // call-site, not "having the name in scope". An app that imports
    // unsafe* without calling it is weird but not the bypass we care
    // about (and the `as` alias case still flags the call below).
    const parent = id.getParent();
    if (!parent) continue;
    const pk = parent.getKind();
    if (pk === SyntaxKind.ImportSpecifier) continue;
    if (pk === SyntaxKind.ExportSpecifier) continue;

    // Skip property-access right-hand-side (`obj.unsafePushTables`):
    // a method on some unrelated type that happens to share the name.
    if (pk === SyntaxKind.PropertyAccessExpression) {
      const pae = parent.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
      if (pae.getNameNode() === id) continue;
    }
    if (pk === SyntaxKind.PropertyAssignment) continue;
    if (pk === SyntaxKind.ShorthandPropertyAssignment) continue;
    // Type-level shadows: `interface { unsafePushTables(): void }` or
    // `type T = { unsafePushTables: () => void }`. Different namespace,
    // not the runtime call.
    if (pk === SyntaxKind.PropertySignature) {
      const ps = parent.asKindOrThrow(SyntaxKind.PropertySignature);
      if (ps.getNameNode() === id) continue;
    }
    if (pk === SyntaxKind.MethodSignature) {
      const ms = parent.asKindOrThrow(SyntaxKind.MethodSignature);
      if (ms.getNameNode() === id) continue;
    }

    const line = id.getStartLineNumber();
    const raw = (lines[line - 1] ?? "").trim();
    const snippet = raw.length > 100 ? `${raw.slice(0, 97)}...` : raw;
    findings.push({
      file: path.relative(repoRoot, absPath),
      line,
      symbol: name,
      snippet,
    });
  }
  return findings;
}

function report(findings: readonly Finding[], scanned: number): void {
  console.log(`Table-DDL Guard: ${scanned} files checked.`);
  if (findings.length === 0) {
    console.log("  No bypass calls outside the allowlist.");
  } else {
    console.log(`  ${findings.length} bypass call(s) outside the allowlist:`);
    for (const f of findings) {
      console.log(`    ${f.file}:${f.line}  ${f.symbol}`);
      console.log(`      ${f.snippet}`);
    }
    console.log("");
    console.log("  Rule: unsafe* calls are reserved for framework-internal code (event-store,");
    console.log("  pipeline-state, stack), test setup (__tests__, drizzle/), app migrate CLIs");
    console.log("  (bin/migrate.ts). Apps declare tables via r.entity() or r.rawTable().");
    console.log("  Plan: kumiko-platform/docs/plans/architecture/table-ddl-guard.md");
    console.log("  Warning, no fail.");
  }
}

export const guard: AstGuard = {
  name: "Table-DDL Guard",
  scan: SCAN,
  run(files) {
    const findings: Finding[] = [];
    let scanned = 0;
    for (const sf of files) {
      scanned++;
      findings.push(...collectFindings(sf, ROOT));
    }
    report(findings, scanned);
    // Warning, no fail (see module header): bypass calls are reported but
    // never block the guard run.
    return { violations: [] };
  },
};

if (import.meta.main) runStandalone(guard);

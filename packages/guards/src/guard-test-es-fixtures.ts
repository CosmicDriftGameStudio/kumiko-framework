#!/usr/bin/env bun
/**
 * Guard: tests seed event-sourced state through the event store, not through
 * hand-written SQL. Flags, in test files, string/template literals with
 *   (a) INSERT INTO / UPDATE against kumiko_events (use append / runSeedWritesAt)
 *   (b) CREATE TABLE ... read_tenant_memberships (use unsafeCreateEntityTable with
 *       tenantMembershipEntity and seedRow, so the schema cannot drift from the entity)
 *
 * Usage:
 *   bun packages/guards/src/guard-test-es-fixtures.ts
 */
import type { SourceFile } from "ts-morph";
import { SyntaxKind } from "ts-morph";
import {
  type AstGuard,
  type GuardViolation,
  relFromRepoRoot,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";
import { type RepoRoot, resolveRepoRoots } from "./_lib/roots";

const SCAN: ScanSpec = { scope: "tests", extensions: ["ts"] };

// Bulk seeding of thousands of events through append() would take minutes; these
// perf tests measure the read path on a finished stream, not the seed phase.
// The concurrent-commit ordering tests hold a transaction open and need explicit event
// ids/versions, which append() does not expose.
// The guards' own tests carry the forbidden SQL as fixture strings.
const ALLOWLIST: readonly RegExp[] = [
  /^packages\/framework\/src\/event-store\/__tests__\/perf\.integration\.test\.ts$/,
  /^packages\/framework\/src\/pipeline\/__tests__\/perf-rebuild\.integration\.test\.ts$/,
  /^packages\/framework\/src\/pipeline\/__tests__\/event-dispatcher-commit-order\.integration\.test\.ts$/,
  /^packages\/framework\/src\/pipeline\/__tests__\/event-dispatcher-start-from\.integration\.test\.ts$/,
  /^packages\/framework\/src\/pipeline\/__tests__\/msp-rebuild\.integration\.test\.ts$/,
  /^packages\/framework\/src\/pipeline\/__tests__\/projection-rebuild\.integration\.test\.ts$/,
  /^packages\/guards\/src\/__tests__\//,
];

const EVENT_WRITE_RE = /\b(INSERT\s+INTO|UPDATE)\s+["`]?kumiko_events\b/i;
const MEMBERSHIP_DDL_RE = /\bCREATE\s+TABLE\b[^;]*?\bread_tenant_memberships\b/i;

const LITERAL_KINDS = [
  SyntaxKind.StringLiteral,
  SyntaxKind.NoSubstitutionTemplateLiteral,
  SyntaxKind.TemplateExpression,
];

function violationMessage(text: string): string | undefined {
  const write = EVENT_WRITE_RE.exec(text);
  if (write)
    return `raw ${write[0].replace(/\s+/g, " ")} in a test: seed via append() or runSeedWritesAt()`;
  if (MEMBERSHIP_DDL_RE.test(text)) {
    return "hand-written read_tenant_memberships DDL in a test: use unsafeCreateEntityTable(db, tenantMembershipEntity)";
  }
  return undefined;
}

function collect(sourceFile: SourceFile, roots: readonly RepoRoot[]): GuardViolation[] {
  const file = relFromRepoRoot(sourceFile.getFilePath(), roots);
  if (ALLOWLIST.some((re) => re.test(file))) return [];
  // Both rules need one of these table names in a literal, which is part of the file's text.
  if (!/kumiko_events|read_tenant_memberships/i.test(sourceFile.getFullText())) return [];
  const violations: GuardViolation[] = [];
  for (const kind of LITERAL_KINDS) {
    for (const node of sourceFile.getDescendantsOfKind(kind)) {
      const message = violationMessage(node.getText());
      if (message) violations.push({ file, line: node.getStartLineNumber(), message });
    }
  }
  return violations;
}

export const guard: AstGuard = {
  name: "Test-ES-Fixtures Guard",
  scan: SCAN,
  hint:
    "Seed events with append() (runSeedWritesAt for backdating) and membership rows with " +
    "seedRow on a table made by unsafeCreateEntityTable; bulk perf seeds belong in the guard allowlist with a Why.",
  run(files, roots: readonly RepoRoot[] = resolveRepoRoots()) {
    return { violations: files.flatMap((sf) => collect(sf, roots)) };
  },
};

if (import.meta.main) runStandalone(guard);

#!/usr/bin/env bun
/**
 * Guard: flags string/template literals containing UPDATE/DELETE FROM/INSERT
 * INTO against kumiko_events, kumiko_snapshots or kumiko_archived_streams
 * outside the event store's own files.
 *
 * These three tables ARE the event store. A direct write from elsewhere
 * bypasses its invariants (version-unique index, archive markers, tenant
 * boundary). Tenant moves go through `transferAggregateStreams`
 * (event-store/transfer.ts); any other need belongs in
 * db/queries/event-store*.ts.
 *
 * Usage:
 *   bun packages/guards/src/guard-event-store-writes.ts
 */

import { type SourceFile, SyntaxKind } from "ts-morph";
import {
  type AstGuard,
  type GuardViolation,
  relFromRepoRoot,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";
import { type RepoRoot, resolveRepoRoots } from "./_lib/roots";

const SCAN: ScanSpec = { scope: "source", extensions: ["ts"] };

// Tests fabricate their own fixture rows directly — they are the primary
// verifiers of the event-store primitives, not a write surface this guard
// needs to police.
const EXCLUDE = /(__tests__|\.test\.ts$|\.integration\.ts$|\.d\.ts$)/;

// Files allowed to write these three tables directly:
//   - event-store/** — the primitive's own home (transfer.ts, event-store.ts,
//     snapshot.ts, archive.ts, admin-api.ts, rebuild-dead-letter.ts, ...).
//   - db/queries/event-store*.ts — the raw-SQL backing queries the primitives
//     call (event-store.ts, event-store-admin.ts, event-store-transfer.ts).
//   - db/queries/backfill-pii.ts — the one-time pre-KMS plaintext backfill;
//     rewrites payload/deletes stale snapshots in place, framework-owned.
//   - user/db/queries/stream-tenant-backfill.ts — a one-time stream-ownership
//     migration that predates this guard; already carries its own
//     RAW_SQL_ALLOWLIST entry, kept here for the same reason.
const ALLOWLIST: readonly RegExp[] = [
  /^packages\/framework\/src\/event-store\//,
  /^packages\/framework\/src\/db\/queries\/event-store.*\.ts$/,
  /^packages\/framework\/src\/db\/queries\/backfill-pii\.ts$/,
  /^packages\/bundled-features\/src\/user\/db\/queries\/stream-tenant-backfill\.ts$/,
];

const ES_TABLES = "kumiko_events|kumiko_snapshots|kumiko_archived_streams";
// One string/template literal must carry both the write verb AND the table
// name — a keyword in one concatenated piece and the table name (behind a
// variable) in another is indirection this guard does not see through; the
// event store's own queries are the only place that literal belongs.
const WRITE_RE = new RegExp(
  `\\b(UPDATE|DELETE\\s+FROM|INSERT\\s+INTO)\\b[\\s\\S]*?["'\`]?(${ES_TABLES})["'\`]?`,
  "i",
);

const LITERAL_KINDS = [
  SyntaxKind.StringLiteral,
  SyntaxKind.NoSubstitutionTemplateLiteral,
  SyntaxKind.TemplateExpression,
];

export type Violation = {
  readonly file: string;
  readonly line: number;
  readonly snippet: string;
};

export function isAllowed(relativePath: string): boolean {
  return ALLOWLIST.some((re) => re.test(relativePath));
}

export function collectViolations(
  sourceFile: SourceFile,
  roots: readonly RepoRoot[] = resolveRepoRoots(),
): Violation[] {
  const violations: Violation[] = [];
  // Repo-root-relative, not `process.cwd()`-relative — a multi-repo runner
  // (e.g. invoked from the parent workspace dir) would otherwise carry a
  // leading `kumiko-framework/` segment that the ALLOWLIST regexes (anchored
  // on `^packages/...`) never match, wrongly flagging every allowed file.
  const relativePath = relFromRepoRoot(sourceFile.getFilePath(), roots);
  if (isAllowed(relativePath)) return violations;

  for (const kind of LITERAL_KINDS) {
    for (const node of sourceFile.getDescendantsOfKind(kind)) {
      const text = node.getText();
      const match = WRITE_RE.exec(text);
      if (!match) continue;
      violations.push({
        file: relativePath,
        line: node.getStartLineNumber(),
        snippet: match[0].replace(/\s+/g, " ").trim().slice(0, 120),
      });
    }
  }
  return violations;
}

export const guard: AstGuard = {
  name: "Event-Store-Writes Guard",
  scan: SCAN,
  hint:
    "kumiko_events/kumiko_snapshots/kumiko_archived_streams may only be written from " +
    "packages/framework/src/event-store/** and their db/queries/event-store*.ts backing. " +
    "Use transferAggregateStreams (event-store/transfer.ts) for a tenant move, or add a " +
    "new event-store primitive instead of writing these tables from feature code.",
  run(files, roots: readonly RepoRoot[] = resolveRepoRoots()) {
    const violations: GuardViolation[] = [];
    for (const sf of files) {
      if (EXCLUDE.test(sf.getFilePath())) continue;
      for (const v of collectViolations(sf, roots)) {
        violations.push({ file: v.file, line: v.line, message: v.snippet });
      }
    }
    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);

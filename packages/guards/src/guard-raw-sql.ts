#!/usr/bin/env bun
/**
 * Raw-SQL Guard — blocks `.unsafe()` / `asRawClient()` outside allowed paths.
 *
 * Escape hatch for a justified raw-SQL call:
 *   // kumiko-lint-ignore raw-sql <reason>
 * on the call's own line or the line directly above (one hit per marker). A bare tag with no
 * reason text after it does NOT suppress the finding — production code
 * should otherwise route SQL through `db/queries/*` or typed
 * `bun-db/query` helpers.
 *
 * Plan: kumiko-platform/docs/plans/architecture/intern/sql-queries-consolidation.md
 */

import { type RepoCheck, reportResults, runRepoChecks } from "./_lib/guard-kit";
import { type RepoRoot, resolveRepoRoots } from "./_lib/roots";
import { BLOCKING_SQL_KINDS, scanRepo, sqlScanLayoutFor } from "./_lib/sql-inventory";

export type RawSqlFinding = {
  readonly repo: string;
  readonly file: string;
  readonly line: number;
  readonly kind: string;
  readonly snippet: string;
};

async function scanAllRepos(roots: readonly RepoRoot[]): Promise<{
  readonly findings: RawSqlFinding[];
  readonly scannedFiles: number;
}> {
  const findings: RawSqlFinding[] = [];
  let scannedFiles = 0;

  for (const root of roots) {
    const report = await scanRepo(root.absPath, sqlScanLayoutFor(root));
    scannedFiles += report.scannedFiles;

    for (const hit of report.hits) {
      if (hit.allowed) continue;
      if (hit.markerSuppressed) continue;
      if (hit.file.includes("/__tests__/")) continue;
      if (!(BLOCKING_SQL_KINDS as readonly string[]).includes(hit.kind)) continue;
      findings.push({
        repo: root.name,
        file: hit.file,
        line: hit.line,
        kind: hit.kind,
        snippet: hit.snippet,
      });
    }
  }

  return { findings, scannedFiles };
}

export async function collectRawSqlFindings(
  roots: readonly RepoRoot[] = resolveRepoRoots(),
): Promise<readonly RawSqlFinding[]> {
  return (await scanAllRepos(roots)).findings;
}

export const check: RepoCheck = {
  name: "guard-raw-sql",
  hint:
    "Rule: runtime SQL only in db/queries/*, bun-db/query.ts, testing/*, or with " +
    "// kumiko-lint-ignore raw-sql <reason> on the line or the line above.",
  async run(roots) {
    // kumiko-platform's deliberate empty scan-dir list must not read as vacuous (infra#610).
    const applicableRoots = roots.filter((r) => sqlScanLayoutFor(r) !== "none");
    if (applicableRoots.length === 0) {
      return { violations: [], matchedFiles: 0, notApplicable: true };
    }
    const { findings, scannedFiles } = await scanAllRepos(applicableRoots);
    return {
      violations: findings.map((f) => ({
        file: f.file,
        line: f.line,
        message: `[${f.kind}] ${f.snippet}`,
      })),
      matchedFiles: scannedFiles,
      notApplicable: false,
    };
  },
};

if (import.meta.main) {
  const failed = reportResults(await runRepoChecks([check]));
  process.exit(failed > 0 ? 1 : 0);
}

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
 * A marker only suppresses while its (file, reason) pair is frozen in
 * `.kumiko-raw-sql-baseline.json` at the repo root, so every new or reworded
 * marker shows up as a baseline diff in review. Without a baseline file the
 * guard only warns (consumers do not break on bump). Freeze with:
 *   bun packages/guards/src/guard-raw-sql.ts --write-baseline
 *   (or `kumiko-guards checks --write-baseline --guard=guard-raw-sql`)
 */

import { existsSync } from "node:fs";
import path from "node:path";
import {
  baselineRatchet,
  type GuardViolation,
  type RepoCheck,
  reportResults,
  runRepoChecks,
} from "./_lib/guard-kit";
import { type RepoRoot, resolveRepoRoots } from "./_lib/roots";
import {
  BLOCKING_SQL_KINDS,
  isSqlScanExcluded,
  scanRepo,
  sqlScanDirsFor,
} from "./_lib/sql-inventory";

export type RawSqlFinding = {
  readonly repo: string;
  readonly file: string;
  readonly line: number;
  readonly kind: string;
  readonly snippet: string;
};

const BASELINE_FILE = ".kumiko-raw-sql-baseline.json";

type RootMarkers = {
  readonly root: RepoRoot;
  /** `<file>::<reason>` → distinct marker lines (1-based, ascending). */
  readonly linesByKey: ReadonlyMap<string, readonly number[]>;
};

function ratchetFor(root: RepoRoot) {
  return baselineRatchet({
    file: path.join(root.absPath, BASELINE_FILE),
    formatVersion: 1,
    unit: "raw-sql marker(s)",
  });
}

function countsOf(markers: RootMarkers): Record<string, number> {
  return Object.fromEntries([...markers.linesByKey].map(([key, lines]) => [key, lines.length]));
}

async function scanAllRepos(roots: readonly RepoRoot[]): Promise<{
  readonly findings: RawSqlFinding[];
  readonly markers: RootMarkers[];
  readonly scannedFiles: number;
}> {
  const findings: RawSqlFinding[] = [];
  const markers: RootMarkers[] = [];
  let scannedFiles = 0;

  for (const root of roots) {
    const report = await scanRepo(root.absPath, sqlScanDirsFor(root));
    scannedFiles += report.scannedFiles;
    const markerLines = new Map<string, Set<number>>();

    for (const hit of report.hits) {
      if (hit.allowed) continue;
      if (hit.file.includes("/__tests__/")) continue;
      if (!(BLOCKING_SQL_KINDS as readonly string[]).includes(hit.kind)) continue;
      if (hit.markerSuppressed) {
        // One line like `asRawClient(db).unsafe(` yields two hits for one marker.
        if (hit.markerReason !== undefined && hit.markerLine !== undefined) {
          const key = `${hit.file}::${hit.markerReason}`;
          const lines = markerLines.get(key) ?? new Set<number>();
          lines.add(hit.markerLine);
          markerLines.set(key, lines);
        }
        continue;
      }
      findings.push({
        repo: root.name,
        file: hit.file,
        line: hit.line,
        kind: hit.kind,
        snippet: hit.snippet,
      });
    }

    markers.push({
      root,
      linesByKey: new Map(
        [...markerLines].map(([key, lines]) => [key, [...lines].sort((x, y) => x - y)]),
      ),
    });
  }

  return { findings, markers, scannedFiles };
}

export async function collectRawSqlFindings(
  roots: readonly RepoRoot[] = resolveRepoRoots(),
): Promise<readonly RawSqlFinding[]> {
  return (await scanAllRepos(roots)).findings;
}

const MARKER_REMEDIATION =
  "New or reworded raw-sql marker. Use a typed bun-db helper (selectMany, selectInnerJoin, " +
  "insertOnConflictDoNothing, upsertOnConflict, aggregateWhere, where jsonText …) if one fits; " +
  "otherwise freeze the exception with `kumiko-guards checks --write-baseline --guard=guard-raw-sql` " +
  "so the baseline diff shows up in review.";

export const check: RepoCheck = {
  name: "guard-raw-sql",
  hint:
    "Rule: runtime SQL only in db/queries/*, bun-db/query.ts, testing/*, or with " +
    "// kumiko-lint-ignore raw-sql <reason> on the line or the line above — and that " +
    "(file, reason) must be frozen in .kumiko-raw-sql-baseline.json " +
    "(`kumiko-guards checks --write-baseline --guard=guard-raw-sql`).",
  async run(roots) {
    // Only the deliberate exclusion is skipped; a repo whose declared source roots
    // are all missing stays in the scan so 0 files surfaces as vacuous.
    const applicableRoots = roots.filter((r) => !isSqlScanExcluded(r));
    if (applicableRoots.length === 0) {
      return { violations: [], matchedFiles: 0, notApplicable: true };
    }
    const { findings, markers, scannedFiles } = await scanAllRepos(applicableRoots);
    // A root without markers and without a baseline has nothing to freeze, so it
    // skips the ratchet's "no baseline found" warning instead of nagging every consumer.
    const markerViolations: GuardViolation[] = markers
      .filter((m) => m.linesByKey.size > 0 || existsSync(path.join(m.root.absPath, BASELINE_FILE)))
      .flatMap((m) =>
        ratchetFor(m.root).check(countsOf(m), MARKER_REMEDIATION, {
          resolveLine: (key) => m.linesByKey.get(key)?.[0] ?? 1,
        }),
      );
    return {
      violations: [
        ...findings.map((f) => ({
          file: f.file,
          line: f.line,
          message: `[${f.kind}] ${f.snippet}`,
        })),
        ...markerViolations,
      ],
      matchedFiles: scannedFiles,
      notApplicable: false,
    };
  },
  async writeBaseline(roots) {
    const applicableRoots = roots.filter((r) => !isSqlScanExcluded(r));
    const { markers } = await scanAllRepos(applicableRoots);
    for (const m of markers) ratchetFor(m.root).write(countsOf(m));
  },
};

if (import.meta.main) {
  if (process.argv.slice(2).includes("--write-baseline")) {
    await check.writeBaseline?.(resolveRepoRoots());
    process.exit(0);
  }
  const failed = reportResults(await runRepoChecks([check]));
  process.exit(failed > 0 ? 1 : 0);
}

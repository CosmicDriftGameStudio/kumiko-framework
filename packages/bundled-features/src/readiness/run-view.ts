import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { PROBE_RUN_STATUS, probeRunsTable } from "./schema/probe-run.ts";
import {
  countResults,
  outcomeOf,
  type ResultCounts,
  type RunOutcome,
  type VisibleProbeResult,
  visibleResults,
} from "./visible-results.ts";

export type RunRow = {
  readonly id: string;
  readonly status: string;
  readonly requestedAt: Temporal.Instant;
  readonly startedAt: Temporal.Instant | null;
  readonly finishedAt: Temporal.Instant | null;
  readonly triggeredByUserId: string;
  readonly durationMs: number | null;
  readonly results: unknown;
};

export type RunView = {
  readonly results: readonly VisibleProbeResult[];
  readonly counts: ResultCounts;
  readonly outcome: RunOutcome;
};

export const HISTORY_LIMIT = 100;

export async function fetchLatestRun(db: TenantDb): Promise<RunRow | undefined> {
  const [latest] = await db.selectMany<RunRow>(
    probeRunsTable,
    { status: [PROBE_RUN_STATUS.Pending, PROBE_RUN_STATUS.Running, PROBE_RUN_STATUS.Done] },
    { limit: 1, orderBy: { col: "requestedAt", direction: "desc" } },
  );
  return latest;
}

// Counts come from the results the caller may see, so a TenantAdmin never learns about system failures.
export function viewRun(run: RunRow, user: SessionUser): RunView {
  const results = visibleResults(run.results, user);
  const counts = countResults(results);
  return { results, counts, outcome: outcomeOf(run.status, counts) };
}

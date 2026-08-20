import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { JobHandlerFn } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { markStaleJobRunsFailed } from "../db/queries/stale-run-sweep";

// 24h, not e.g. the 1h cache-TTL used elsewhere in this feature (see
// job-run-logger.ts) — a wrong guess there costs one extra DB lookup, a
// wrong guess here marks a still-running job "failed" and opens
// retry.write.ts's retry gate on it while the original run is still
// executing (concurrent duplicate dispatch). reindexEntity/projectionRebuild
// (registered in this same feature) can legitimately run for hours, so the
// default has to clear any plausible real job, not just be "long".
// Configurable per-app via JobsFeatureOptions.staleRunTimeoutHours.
export const DEFAULT_JOB_RUN_STALE_TIMEOUT_HOURS = 24;

export function createStaleRunSweepJob(timeoutHours: number): JobHandlerFn {
  return async (_payload, ctx) => {
    if (!ctx.db) {
      throw new InternalError({
        message:
          "[jobs:stale-run-sweep] ctx.db missing — job context requires a database connection.",
      });
    }
    const db = ctx.db as DbConnection; // @cast-boundary db-operator (matches sibling cron jobs)
    const result = await markStaleJobRunsFailed(db, timeoutHours);
    ctx.log?.info?.(`[jobs:stale-run-sweep] complete: ${JSON.stringify(result)}`);
  };
}

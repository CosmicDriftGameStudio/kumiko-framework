import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { JobHandlerFn } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { deleteStaleJobRuns } from "../db/queries/retention";

// Single source for the retention window — change here, nowhere else.
export const DEFAULT_JOB_RUN_RETENTION_DAYS = 30;

export function createRetentionCleanupJob(retentionDays: number): JobHandlerFn {
  return async (_payload, ctx) => {
    if (!ctx.db) {
      throw new InternalError({
        message:
          "[jobs:retention-cleanup] ctx.db missing — job context requires a database connection.",
      });
    }
    const db = ctx.db as DbConnection; // @cast-boundary db-operator (matches sibling cron jobs)
    const result = await deleteStaleJobRuns(db, retentionDays);
    ctx.log?.info?.(`[jobs:retention-cleanup] complete: ${JSON.stringify(result)}`);
  };
}

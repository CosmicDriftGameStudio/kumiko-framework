import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { JobHandlerFn } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { deleteStaleJobRuns } from "../db/queries/retention";

// Single source for the retention window — change here, nowhere else.
export const DEFAULT_JOB_RUN_RETENTION_DAYS = 30;

export function createRetentionCleanupJob(retentionDays: number): JobHandlerFn {
  return async (_payload, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({
        message:
          "[jobs:retention-cleanup] ctx.systemDb missing — is r.systemScope() still set on the jobs feature?",
      });
    }
    const db = ctx.systemDb.unsafeRaw(
      "store_job_runs retention purges finished runs of every tenant",
    ) as DbConnection; // @cast-boundary db-operator — DbRunner narrows to DbConnection, jobs never run inside a DbTx
    const result = await deleteStaleJobRuns(db, retentionDays);
    ctx.log?.info?.(`[jobs:retention-cleanup] complete: ${JSON.stringify(result)}`);
  };
}

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { JobHandlerFn } from "@cosmicdrift/kumiko-framework/engine";
import { requireSystemDb } from "../../shared/index.ts";
import { deleteStaleJobRuns } from "../db/queries/retention.ts";

// Single source for the retention window — change here, nowhere else.
export const DEFAULT_JOB_RUN_RETENTION_DAYS = 30;

export function createRetentionCleanupJob(retentionDays: number): JobHandlerFn {
  return async (_payload, ctx) => {
    const systemDb = requireSystemDb(ctx, "jobs:retention-cleanup");
    const db = systemDb.unsafeRaw(
      "store_job_runs retention purges finished runs of every tenant",
    ) as DbConnection; // @cast-boundary db-operator — DbRunner narrows to DbConnection, jobs never run inside a DbTx
    const result = await deleteStaleJobRuns(db, retentionDays);
    ctx.obs.log?.info?.(`[jobs:retention-cleanup] complete: ${JSON.stringify(result)}`);
  };
}

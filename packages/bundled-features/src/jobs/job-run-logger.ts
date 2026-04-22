import type { DbConnection } from "@kumiko/framework/db";
import type { JobLogEntry, JobMeta, JobRunnerOptions } from "@kumiko/framework/jobs";
import { eq } from "drizzle-orm";
import { jobRunLogsTable, jobRunsTable } from "./job-run-table";

export type JobRunLoggerCallbacks = Pick<
  JobRunnerOptions,
  "onJobStart" | "onJobComplete" | "onJobFailed"
>;

async function saveLogs(db: DbConnection, runId: number, logs: JobLogEntry[]): Promise<void> {
  // skip: no log entries to persist
  if (logs.length === 0) return;

  await db.insert(jobRunLogsTable).values(
    logs.map((log) => ({
      runId,
      level: log.level,
      message: log.message,
      timestamp: log.timestamp,
    })),
  );
}

export function createJobRunLogger(db: DbConnection): JobRunLoggerCallbacks {
  return {
    onJobStart: async (jobName: string, jobId: string, meta: JobMeta) => {
      await db.insert(jobRunsTable).values({
        jobName,
        bullJobId: jobId,
        status: "running",
        payload: meta.payload,
        triggeredById: meta.triggeredById,
        startedAt: Temporal.Now.instant(),
      });
    },

    onJobComplete: async (
      _jobName: string,
      jobId: string,
      duration: number,
      logs: JobLogEntry[],
    ) => {
      await db
        .update(jobRunsTable)
        .set({ status: "completed", finishedAt: Temporal.Now.instant(), duration })
        .where(eq(jobRunsTable.bullJobId, jobId));

      const [run] = await db
        .select({ id: jobRunsTable.id })
        .from(jobRunsTable)
        .where(eq(jobRunsTable.bullJobId, jobId));

      if (run) await saveLogs(db, run.id, logs);
    },

    onJobFailed: async (_jobName: string, jobId: string, error: string, logs: JobLogEntry[]) => {
      const [existing] = await db
        .select({ id: jobRunsTable.id, startedAt: jobRunsTable.startedAt })
        .from(jobRunsTable)
        .where(eq(jobRunsTable.bullJobId, jobId));

      if (existing) {
        await db
          .update(jobRunsTable)
          .set({
            status: "failed",
            error,
            finishedAt: Temporal.Now.instant(),
            duration: Temporal.Now.instant()
              .since(existing.startedAt)
              .total({ unit: "millisecond" }),
          })
          .where(eq(jobRunsTable.bullJobId, jobId));

        await saveLogs(db, existing.id, logs);
      }
    },
  };
}

import type { DbConnection } from "@kumiko/framework/db";
import { type Registry, SYSTEM_TENANT_ID } from "@kumiko/framework/engine";
import { append, getStreamVersion } from "@kumiko/framework/event-store";
import type { JobLogEntry, JobMeta, JobRunnerOptions } from "@kumiko/framework/jobs";
import { runProjectionsForEvent } from "@kumiko/framework/pipeline";
import { generateId } from "@kumiko/framework/utils";
import { eq } from "drizzle-orm";
import { jobRunsTable } from "./job-run-table";

// ES job-run lifecycle:
//   - onJobStart  → jobs:event:run-started   (first append, version 0→1)
//   - onJobComplete → jobs:event:run-completed (append at current version,
//                     payload carries the batched logs)
//   - onJobFailed   → jobs:event:run-failed    (same shape as completed + error)
//
// BullMQ callbacks don't carry a tenantId (jobs are cross-tenant). We
// anchor every run on SYSTEM_TENANT_ID — mirrors how config system-scope
// rows use the sentinel. The stream still works per-run because
// aggregate_id is a fresh UUID per run.

export const JOB_RUN_STARTED_EVENT = "jobs:event:run-started" as const;
export const JOB_RUN_COMPLETED_EVENT = "jobs:event:run-completed" as const;
export const JOB_RUN_FAILED_EVENT = "jobs:event:run-failed" as const;

export type JobRunLoggerOptions = {
  readonly db: DbConnection;
  readonly registry: Registry;
};

export type JobRunLoggerCallbacks = Pick<
  JobRunnerOptions,
  "onJobStart" | "onJobComplete" | "onJobFailed"
>;

export function createJobRunLogger(opts: JobRunLoggerOptions): JobRunLoggerCallbacks {
  const { db, registry } = opts;

  // bullJobId → aggregate uuid. BullMQ hands us the bullJobId on every
  // callback, but our aggregate stream is keyed by a fresh UUID we mint
  // on start. The map threads that UUID from onJobStart through to
  // onJobComplete/onJobFailed so the completion-event lands on the same
  // stream as the start-event.
  //
  // Falls back to a DB lookup (bullJobId → aggregate id) when the worker
  // is restarted between start and completion — in-memory state is lost,
  // but the projection row carries bull_job_id for exactly this recovery.
  const runIdByBullJobId = new Map<string, string>();

  async function resolveRunId(bullJobId: string): Promise<string | undefined> {
    const cached = runIdByBullJobId.get(bullJobId);
    if (cached) return cached;
    const [row] = await db
      .select({ id: jobRunsTable.id })
      .from(jobRunsTable)
      .where(eq(jobRunsTable.bullJobId, bullJobId));
    // buildBaseColumns returns a union (serial-or-uuid PK) — narrow via
    // String() since this specific table uses uuid mode. Cast avoids
    // adding a branded-id type that leaks across feature boundaries.
    const id = row ? String(row.id) : undefined;
    if (id) runIdByBullJobId.set(bullJobId, id);
    return id;
  }

  return {
    onJobStart: async (jobName: string, bullJobId: string, meta: JobMeta) => {
      const runId = generateId();
      runIdByBullJobId.set(bullJobId, runId);
      const event = await append(db, {
        aggregateId: runId,
        aggregateType: "jobRun",
        tenantId: SYSTEM_TENANT_ID,
        expectedVersion: 0,
        type: JOB_RUN_STARTED_EVENT,
        payload: {
          jobName,
          bullJobId,
          status: "running",
          payload: meta.payload ?? null,
          triggeredById: meta.triggeredById ?? null,
          startedAt: Temporal.Now.instant().toString(),
          attempt: 1,
        },
        metadata: { userId: "system" },
      });
      await runProjectionsForEvent(event, registry, db);
    },

    onJobComplete: async (
      _jobName: string,
      bullJobId: string,
      duration: number,
      logs: JobLogEntry[],
    ) => {
      const runId = await resolveRunId(bullJobId);
      // skip: state loss between start + complete (worker restart, cache
      // evicted AND DB has no matching bull_job_id). Rare edge case; we
      // drop the completion event rather than forging a jobRun aggregate
      // from scratch — forensics still has the original BullMQ lifecycle.
      if (!runId) return;
      const currentVersion = await getStreamVersion(db, runId, SYSTEM_TENANT_ID);
      const event = await append(db, {
        aggregateId: runId,
        aggregateType: "jobRun",
        tenantId: SYSTEM_TENANT_ID,
        expectedVersion: currentVersion,
        type: JOB_RUN_COMPLETED_EVENT,
        payload: {
          duration,
          finishedAt: Temporal.Now.instant().toString(),
          logs: logs.map((l) => ({
            level: l.level,
            message: l.message,
            timestamp: l.timestamp.toString(),
          })),
        },
        metadata: { userId: "system" },
      });
      await runProjectionsForEvent(event, registry, db);
      runIdByBullJobId.delete(bullJobId);
    },

    onJobFailed: async (
      _jobName: string,
      bullJobId: string,
      error: string,
      logs: JobLogEntry[],
    ) => {
      const runId = await resolveRunId(bullJobId);
      // skip: same rare state-loss case as in onJobComplete — drop the
      // failure event rather than forge a jobRun aggregate from scratch.
      if (!runId) return;
      const currentVersion = await getStreamVersion(db, runId, SYSTEM_TENANT_ID);
      // Read started_at off the projection so we can compute duration
      // symmetrically to onJobComplete (which gets duration from the
      // worker). The projection already has started_at from the
      // run-started inline-apply.
      const [row] = await db
        .select({ startedAt: jobRunsTable.startedAt })
        .from(jobRunsTable)
        .where(eq(jobRunsTable.id, runId));
      const now = Temporal.Now.instant();
      const duration = row ? Number(now.since(row.startedAt).total({ unit: "millisecond" })) : 0;
      const event = await append(db, {
        aggregateId: runId,
        aggregateType: "jobRun",
        tenantId: SYSTEM_TENANT_ID,
        expectedVersion: currentVersion,
        type: JOB_RUN_FAILED_EVENT,
        payload: {
          duration,
          finishedAt: now.toString(),
          error,
          logs: logs.map((l) => ({
            level: l.level,
            message: l.message,
            timestamp: l.timestamp.toString(),
          })),
        },
        metadata: { userId: "system" },
      });
      await runProjectionsForEvent(event, registry, db);
      runIdByBullJobId.delete(bullJobId);
    },
  };
}

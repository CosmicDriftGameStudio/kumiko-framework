import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { type Registry, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { append, getStreamVersion } from "@cosmicdrift/kumiko-framework/event-store";
import type { JobLogEntry, JobMeta, JobRunnerOptions } from "@cosmicdrift/kumiko-framework/jobs";
import { runProjectionsForEvent } from "@cosmicdrift/kumiko-framework/pipeline";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { eq } from "drizzle-orm";
import { runCompletedSchema, runFailedSchema, runStartedSchema } from "./events";
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

// Default cap on the bullJobId → runId cache. A worker that starts jobs
// without ever seeing complete/failed callbacks (e.g. crashes mid-run)
// would otherwise leak entries indefinitely. 10k fits ~1 hour of
// high-throughput jobs; past that we evict oldest. DB-lookup recovers
// evicted entries, so correctness isn't at stake — only memory bounds.
const DEFAULT_CACHE_MAX_ENTRIES = 10_000;
// Entry TTL. A run that hangs longer than this is either a real stuck
// worker (ops should alert) or a test-environment run that never fired
// complete/failed; either way the cache entry has no value. Falls back
// to DB-lookup if actually needed.
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export function createJobRunLogger(opts: JobRunLoggerOptions): JobRunLoggerCallbacks {
  const { db, registry } = opts;

  // bullJobId → aggregate uuid. BullMQ hands us the bullJobId on every
  // callback, but our aggregate stream is keyed by a fresh UUID we mint
  // on start. The cache threads that UUID from onJobStart through to
  // onJobComplete/onJobFailed so the completion-event lands on the same
  // stream as the start-event.
  //
  // Bounded cache (LRU-ish with TTL) — worker-crash between start and
  // complete would otherwise leak entries. DB-lookup recovers evicted
  // entries via bull_job_id on the projection.
  type CacheEntry = { readonly runId: string; readonly expiresAt: number };
  const runIdByBullJobId = new Map<string, CacheEntry>();

  function cachePut(bullJobId: string, runId: string): void {
    // Enforce max-size BEFORE insert. Map iteration returns insertion
    // order, so dropping the first entry is the oldest.
    if (runIdByBullJobId.size >= DEFAULT_CACHE_MAX_ENTRIES) {
      const oldest = runIdByBullJobId.keys().next().value;
      if (oldest !== undefined) runIdByBullJobId.delete(oldest);
    }
    runIdByBullJobId.set(bullJobId, {
      runId,
      expiresAt: Date.now() + DEFAULT_CACHE_TTL_MS,
    });
  }

  function cacheGet(bullJobId: string): string | undefined {
    const entry = runIdByBullJobId.get(bullJobId);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      runIdByBullJobId.delete(bullJobId); // immediate cleanup on terminal callback
      return undefined;
    }
    return entry.runId;
  }

  async function resolveRunId(bullJobId: string): Promise<string | undefined> {
    const cached = cacheGet(bullJobId);
    if (cached) return cached;
    const [row] = await db
      .select({ id: jobRunsTable.id })
      .from(jobRunsTable)
      .where(eq(jobRunsTable.bullJobId, bullJobId));
    // buildBaseColumns's signature types `id` as `string | number` because
    // it returns both branches of the idType union. We know this table
    // was built with idType: "uuid" (see job-run-table.ts), so narrowing
    // via String() is safe runtime-wise. A proper framework-level fix
    // would overload buildBaseColumns per idType — scoped out of this
    // follow-up as its return type has four branches (with/without
    // softDelete × serial/uuid).
    const id = row ? String(row.id) : undefined;
    if (id) cachePut(bullJobId, id);
    return id;
  }

  return {
    onJobStart: async (jobName: string, bullJobId: string, meta: JobMeta) => {
      const runId = generateId();
      cachePut(bullJobId, runId);
      // Parse against the registered schema so out-of-dispatcher writes
      // get the same validation guarantee as ctx.appendEvent. A shape
      // drift between feature + logger fails loudly at the source
      // instead of silently landing on the events-table.
      const payload = runStartedSchema.parse({
        jobName,
        bullJobId,
        status: "running",
        payload: meta.payload ?? null,
        triggeredById: meta.triggeredById ?? null,
        startedAt: Temporal.Now.instant().toString(),
        attempt: meta.attempt ?? 1,
      });
      const event = await append(db, {
        aggregateId: runId,
        aggregateType: "jobRun",
        tenantId: SYSTEM_TENANT_ID,
        expectedVersion: 0,
        type: JOB_RUN_STARTED_EVENT,
        payload,
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
      const payload = runCompletedSchema.parse({
        duration,
        finishedAt: Temporal.Now.instant().toString(),
        logs: logs.map((l) => ({
          level: l.level,
          message: l.message,
          timestamp: l.timestamp.toString(),
        })),
      });
      const event = await append(db, {
        aggregateId: runId,
        aggregateType: "jobRun",
        tenantId: SYSTEM_TENANT_ID,
        expectedVersion: currentVersion,
        type: JOB_RUN_COMPLETED_EVENT,
        payload,
        metadata: { userId: "system" },
      });
      await runProjectionsForEvent(event, registry, db);
      runIdByBullJobId.delete(bullJobId); // immediate cleanup on terminal callback
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
      const payload = runFailedSchema.parse({
        duration,
        finishedAt: now.toString(),
        error,
        logs: logs.map((l) => ({
          level: l.level,
          message: l.message,
          timestamp: l.timestamp.toString(),
        })),
      });
      const event = await append(db, {
        aggregateId: runId,
        aggregateType: "jobRun",
        tenantId: SYSTEM_TENANT_ID,
        expectedVersion: currentVersion,
        type: JOB_RUN_FAILED_EVENT,
        payload,
        metadata: { userId: "system" },
      });
      await runProjectionsForEvent(event, registry, db);
      runIdByBullJobId.delete(bullJobId); // immediate cleanup on terminal callback
    },
  };
}

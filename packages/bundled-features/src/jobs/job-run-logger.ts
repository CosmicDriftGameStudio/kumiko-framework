import {
  deleteMany,
  fetchOne,
  insertMany,
  insertOnConflictDoNothing,
  insertOne,
  transaction,
  updateMany,
  upsertOnConflict,
} from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configuredPiiSubjectKms,
  encryptPiiValueForSubject,
  KeyErasedError,
  type LocalKeyKmsAdapter,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import { acquireNamespacedAdvisoryLock, type DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { type Registry, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import type {
  JobLogEntry,
  JobMeta,
  JobOutcomeMeta,
  JobQueuedMeta,
  JobRunnerOptions,
} from "@cosmicdrift/kumiko-framework/jobs";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { mapWithConcurrency } from "../shared/index.js";
import { runCompletedSchema, runFailedSchema, runStartedSchema } from "./events.js";
import { parseJobInstant } from "./job-instant.js";
import { jobRunLogsTable, jobRunsTable } from "./job-run-table.js";
import { tenantJobFailuresTable } from "./tenant-job-failure-table.js";
import { tenantJobRunsTable } from "./tenant-job-run-table.js";

// Matches PgKmsAdapter's default pool size (see tenant/handlers/*.query.ts) —
// bounds concurrent getOrCreateDek calls so a large log batch doesn't claim
// every connection in the pool.
const KMS_POOL_CONCURRENCY = 4;

// Direct-write job-run log (#2243): onJobStart/-Complete/-Failed write
// straight into jobRunsTable / jobRunLogsTable instead of appending to the
// event store and replaying through inline projections. Pre-#2243 every run
// left two permanent `kumiko_events` rows that nothing else ever replayed
// or MSP-subscribed to — in two production apps that was ~99% of all
// events. Same tables, same shape, no event stream in between.
//
// BullMQ callbacks don't carry a tenantId (jobs are cross-tenant). We
// anchor every run on SYSTEM_TENANT_ID — mirrors how config system-scope
// rows use the sentinel.

export type JobRunLoggerOptions = {
  readonly db: DbConnection;
  readonly registry: Registry;
};

export type JobRunLoggerCallbacks = Pick<
  JobRunnerOptions,
  "onJobStart" | "onJobComplete" | "onJobFailed" | "onJobQueued" | "onJobDropped"
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

// Same per-subject encryption as encryptFailureError/encryptStartedPayload,
// applied to a single value — shared so payload/message/error all go
// through the identical erased-key fallback. A key erased right before (or
// between) any of these callbacks must not blow up the write (status is
// already committed by the time logs/error land): fall back to the
// sentinel like decryptPiiValueForSubject does on the read side, instead of
// throwing and dropping the rest of the batch — or, for onJobStart, the
// whole run row.
async function encryptOrSentinel(
  kms: LocalKeyKmsAdapter,
  subjectUserId: string,
  value: string,
  field: string,
): Promise<string> {
  try {
    return await encryptPiiValueForSubject(
      kms,
      { kind: "user", userId: subjectUserId },
      value,
      { requestId: "jobs:job-run-logger" },
      field,
    );
  } catch (e) {
    if (!(e instanceof KeyErasedError)) throw e;
    return PII_ERASED_SENTINEL;
  }
}

// Same per-subject encryption as encryptStartedPayload, applied to each
// batched log line's `message` (#2247) before insertMany into
// jobRunLogsTable — that table is unmanaged/direct-write, so there is no
// event-piiFields catalog to lean on here either. "message" is the AAD
// field name and must match the field passed to decryptStoredPii on read
// (detail.query.ts) or decrypt fails loud. Same skip rules as the payload:
// null subject (system/cron runs) and absent KMS (rollout mode) both stay
// plaintext. Bounded concurrency (#2307) — unbounded Promise.all would fire
// one getOrCreateDek per log line at once against the KMS adapter's pool.
async function encryptLogMessages<T extends { readonly message: string }>(
  logs: readonly T[],
  triggeredById: string | null,
): Promise<T[]> {
  if (triggeredById === null) return [...logs];
  const kms = configuredPiiSubjectKms();
  if (!kms) return [...logs];
  return mapWithConcurrency(logs, KMS_POOL_CONCURRENCY, async (log) => ({
    ...log,
    message: await encryptOrSentinel(kms, triggeredById, log.message, "message"),
  }));
}

// Mirrors encryptFailureError for the failure-path `error` column (#2307):
// stored alongside logs[].message under the same triggering user's DEK, so
// a log/error pair from the same failed run decrypt together or erase
// together. Exported so stale-run-sweep.ts's crash-recovery write (a
// separate, per-row batch path outside onJobFailed) applies the identical
// per-subject encryption instead of writing `error` in the clear.
export async function encryptFailureError(
  error: string,
  triggeredById: string | null,
): Promise<string> {
  if (triggeredById === null) return error;
  const kms = configuredPiiSubjectKms();
  if (!kms) return error;
  return encryptOrSentinel(kms, triggeredById, error, "error");
}

// The run-started payload can carry arbitrary user data; triggeredById
// names its owning user. No event-PII catalog involved (#2243 removed the
// jobRun r.defineEvent registrations, so there is nothing to catalog) —
// the subject is known statically, so we encrypt directly. A null subject
// (system cron runs, recipient-less triggers) stays plaintext: there is no
// user key to shred, mirroring the previous event-pii catalog's own skip
// rule. Absent KMS adapter stays plaintext too (rollout mode, unchanged).
// A key already erased by the time the trigger lands (#2307) must not fail
// the whole run-start write — sentinel like the log/error paths.
async function encryptStartedPayload(
  payload: string | null,
  triggeredById: string | null,
): Promise<string | null> {
  if (payload === null || triggeredById === null) return payload;
  const kms = configuredPiiSubjectKms();
  if (!kms) return payload;
  return encryptOrSentinel(kms, triggeredById, payload, "payload");
}

// pg_advisory_xact_lock namespace (int4): 'tjfl' as ASCII, disjoint from the
// framework's other fixed advisory-lock keys.
const TENANT_JOB_FAILURE_LOCK_NAMESPACE = 0x746a666c;

// fw#3079 — which row the tenant-visible failure record lives in: one per
// (tenant, job, subject), so the next outcome of the same work replaces or
// clears it. `subject` is null for a job that declares no subjectFields.
// Null target = nothing to write or clear: the job did not opt in, the run
// was tenant-less (cron resolves to SYSTEM_TENANT_ID, where no tenant-scoped
// query could ever read the row), or the caller predates fw#3079 and passes
// no outcome at all.
function tenantJobFailureTarget(
  jobName: string,
  outcome: JobOutcomeMeta | undefined,
): Record<string, unknown> | null {
  if (!outcome?.tenantVisible || outcome.tenantId === SYSTEM_TENANT_ID) return null;
  return { tenantId: outcome.tenantId, jobName, subject: outcome.tenantVisible.subject };
}

async function recordTenantJobFailure(
  db: DbConnection,
  jobName: string,
  outcome: JobOutcomeMeta | undefined,
): Promise<void> {
  const where = tenantJobFailureTarget(jobName, outcome);
  const messageKey = outcome?.tenantVisible?.messageKey;
  // skip: no tenant-visible target, or an attempt BullMQ may still retry — a
  // non-final failure must not show the tenant a failure the next attempt
  // may still resolve.
  if (!where || !messageKey || outcome?.finalAttempt !== true) return;
  // Delete-then-insert under a per-key lock instead of an upsert: the two
  // partial unique indexes (subject NULL vs. set) are no ON CONFLICT target.
  // The lock makes the later of two racing final failures replace the earlier
  // one; the indexes are the backstop against any writer that skips the lock.
  await transaction(db, async (tx) => {
    await acquireNamespacedAdvisoryLock(
      tx,
      TENANT_JOB_FAILURE_LOCK_NAMESPACE,
      JSON.stringify([where["tenantId"], where["jobName"], where["subject"]]),
    );
    await deleteMany(tx, tenantJobFailuresTable, where);
    await insertOne(tx, tenantJobFailuresTable, {
      ...where,
      messageKey,
      failedAt: Temporal.Now.instant(),
    });
  });
}

async function clearTenantJobFailure(
  db: DbConnection,
  jobName: string,
  outcome: JobOutcomeMeta | undefined,
): Promise<void> {
  const where = tenantJobFailureTarget(jobName, outcome);
  // skip: no tenant-visible target — nothing was ever recorded
  if (!where) return;
  await deleteMany(db, tenantJobFailuresTable, where);
}

// fw#3616 — tenant-visible run state. One row per BullMQ job in
// store_tenant_job_runs; the writes below only ever touch rows of the same
// bullJobId, except pruning older finished rows of the same key.
type TenantRunKey = {
  readonly tenantId: string;
  readonly jobName: string;
  readonly subject: string | null;
};

function tenantRunKey(
  jobName: string,
  tenantId: string,
  subject: string | null,
): TenantRunKey | null {
  // skip: tenant-less run (cron resolves to SYSTEM_TENANT_ID) — no tenant-scoped query could read it
  if (tenantId === SYSTEM_TENANT_ID) return null;
  return { tenantId, jobName, subject };
}

async function recordTenantRunQueued(
  db: DbConnection,
  jobName: string,
  bullJobId: string,
  meta: JobQueuedMeta,
): Promise<void> {
  const key = tenantRunKey(jobName, meta.tenantId, meta.subject);
  // skip: system-tenant run, no tenant-scoped query reads it
  if (!key) return;
  const now = Temporal.Now.instant();
  // DO NOTHING: a fast worker can report the start before this enqueue hook
  // returns, and a repeated jobId (debounce, fan-out dedup) is the same job.
  await insertOnConflictDoNothing(
    db,
    tenantJobRunsTable,
    { ...key, bullJobId, status: "queued", queuedAt: now, updatedAt: now },
    { conflictKeys: ["bullJobId"] },
  );
}

async function recordTenantRunStarted(
  db: DbConnection,
  jobName: string,
  bullJobId: string,
  meta: JobMeta,
): Promise<void> {
  // skip: job did not opt in to tenantVisibleRun
  if (!meta.tenantVisibleRun) return;
  const key = tenantRunKey(jobName, meta.tenantVisibleRun.tenantId, meta.tenantVisibleRun.subject);
  // skip: system-tenant run, no tenant-scoped query reads it
  if (!key) return;
  const now = Temporal.Now.instant();
  await upsertOnConflict(
    db,
    tenantJobRunsTable,
    { ...key, bullJobId, status: "running", startedAt: now, updatedAt: now },
    {
      conflictKeys: ["bullJobId"],
      update: { status: "running", startedAt: now, finishedAt: null, updatedAt: now },
    },
  );
}

async function recordTenantRunOutcome(
  db: DbConnection,
  jobName: string,
  bullJobId: string,
  outcome: JobOutcomeMeta | undefined,
  result: "completed" | "failed",
): Promise<void> {
  // skip: job did not opt in to tenantVisibleRun
  if (!outcome?.tenantVisibleRun) return;
  const key = tenantRunKey(jobName, outcome.tenantId, outcome.tenantVisibleRun.subject);
  // skip: system-tenant run, no tenant-scoped query reads it
  if (!key) return;
  const now = Temporal.Now.instant();
  // A failed attempt BullMQ will retry goes back to waiting: the tenant keeps
  // seeing pending work, not a failure the next attempt may still resolve.
  if (result === "failed" && !outcome.finalAttempt) {
    await updateMany(
      db,
      tenantJobRunsTable,
      { status: "queued", startedAt: null, finishedAt: null, updatedAt: now },
      { bullJobId },
    );
    // skip: retry pending, the row stays active until the final attempt
    return;
  }
  await upsertOnConflict(
    db,
    tenantJobRunsTable,
    { ...key, bullJobId, status: result, finishedAt: now, updatedAt: now },
    { conflictKeys: ["bullJobId"], update: { status: result, finishedAt: now, updatedAt: now } },
  );
  await deleteMany(db, tenantJobRunsTable, {
    ...key,
    status: { in: ["completed", "failed"] },
    bullJobId: { ne: bullJobId },
  });
}

async function dropTenantRunQueued(db: DbConnection, bullJobId: string): Promise<void> {
  await deleteMany(db, tenantJobRunsTable, { bullJobId, status: "queued" });
}

const log = createFallbackLogger("job-run-logger");

// The tenant run state is an optional side write: a throw here must not
// fail the enqueue, skip the run-row write or turn a completed run into a
// BullMQ retry.
async function isolateTenantRunWrite(
  write: () => Promise<void>,
  jobName: string,
  bullJobId: string,
): Promise<void> {
  try {
    await write();
  } catch (e) {
    log.error("tenant job run state write failed", {
      jobName,
      bullJobId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// The tenant failure record is an optional side write: a throw here must not
// skip the run-row update or turn a completed run into a BullMQ retry.
async function isolateTenantFailureWrite(
  write: () => Promise<void>,
  jobName: string,
  bullJobId: string,
): Promise<void> {
  try {
    await write();
  } catch (e) {
    log.error("tenant job failure record write failed", {
      jobName,
      bullJobId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export function createJobRunLogger(opts: JobRunLoggerOptions): JobRunLoggerCallbacks {
  const { db } = opts;

  // bullJobId → run uuid. BullMQ hands us the bullJobId on every callback,
  // but the run row is keyed by a fresh UUID we mint on start. The cache
  // threads that UUID from onJobStart through to onJobComplete/onJobFailed
  // so the completion-write lands on the same row as the start-write.
  //
  // Bounded cache (LRU-ish with TTL) — worker-crash between start and
  // complete would otherwise leak entries. DB-lookup recovers evicted
  // entries via bull_job_id on jobRunsTable.
  // triggeredById rides along with runId (#2247) — resolved once at start
  // (or on cache-miss DB fallback) so onJobComplete/-Failed know the log
  // subject without an extra always-on DB round trip.
  type CacheEntry = {
    readonly runId: string;
    readonly triggeredById: string | null;
    readonly expiresAt: number;
  };
  const runIdByBullJobId = new Map<string, CacheEntry>();

  function cachePut(bullJobId: string, runId: string, triggeredById: string | null): void {
    // Enforce max-size BEFORE insert. Map iteration returns insertion
    // order, so dropping the first entry is the oldest.
    if (runIdByBullJobId.size >= DEFAULT_CACHE_MAX_ENTRIES) {
      const oldest = runIdByBullJobId.keys().next().value;
      if (oldest !== undefined) runIdByBullJobId.delete(oldest);
    }
    runIdByBullJobId.set(bullJobId, {
      runId,
      triggeredById,
      expiresAt: Date.now() + DEFAULT_CACHE_TTL_MS,
    });
  }

  function cacheGet(bullJobId: string): CacheEntry | undefined {
    const entry = runIdByBullJobId.get(bullJobId);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      runIdByBullJobId.delete(bullJobId); // immediate cleanup on terminal callback
      return undefined;
    }
    return entry;
  }

  async function resolveRun(
    bullJobId: string,
  ): Promise<{ readonly runId: string; readonly triggeredById: string | null } | undefined> {
    const cached = cacheGet(bullJobId);
    if (cached) return { runId: cached.runId, triggeredById: cached.triggeredById };
    const row = await fetchOne<{ id: string | number; triggeredById: string | null }>(
      db,
      jobRunsTable,
      { bullJobId },
    );
    if (!row) return undefined;
    // buildBaseColumns's signature types `id` as `string | number` because
    // it returns both branches of the idType union. We know this table
    // was built with idType: "uuid" (see job-run-table.ts), so narrowing
    // via String() is safe runtime-wise. A proper framework-level fix
    // would overload buildBaseColumns per idType — scoped out of this
    // follow-up as its return type has four branches (with/without
    // softDelete × serial/uuid).
    const runId = String(row.id);
    const triggeredById = row.triggeredById ?? null;
    cachePut(bullJobId, runId, triggeredById);
    return { runId, triggeredById };
  }

  return {
    onJobQueued: async (jobName: string, bullJobId: string, meta: JobQueuedMeta) => {
      await isolateTenantRunWrite(
        () => recordTenantRunQueued(db, jobName, bullJobId, meta),
        jobName,
        bullJobId,
      );
    },

    onJobDropped: async (jobName: string, bullJobId: string) => {
      await isolateTenantRunWrite(() => dropTenantRunQueued(db, bullJobId), jobName, bullJobId);
    },

    onJobStart: async (jobName: string, bullJobId: string, meta: JobMeta) => {
      await isolateTenantRunWrite(
        () => recordTenantRunStarted(db, jobName, bullJobId, meta),
        jobName,
        bullJobId,
      );
      const runId = generateId();
      const triggeredById = meta.triggeredById ?? null;
      cachePut(bullJobId, runId, triggeredById);
      // Parse against the registered schema so out-of-dispatcher writes
      // get the same validation guarantee as ctx.appendEvent. A shape
      // drift between feature + logger fails loudly at the source
      // instead of silently landing on the table.
      const payload = runStartedSchema.parse({
        jobName,
        bullJobId,
        status: "running",
        payload: meta.payload ?? null,
        triggeredById,
        startedAt: Temporal.Now.instant().toString(),
        attempt: meta.attempt ?? 1,
      });
      const encryptedPayload = await encryptStartedPayload(payload.payload, payload.triggeredById);
      await insertOne(db, jobRunsTable, {
        id: runId,
        tenantId: SYSTEM_TENANT_ID,
        insertedById: "system",
        jobName: payload.jobName,
        bullJobId: payload.bullJobId,
        status: payload.status,
        payload: encryptedPayload,
        attempt: payload.attempt,
        startedAt: parseJobInstant(payload.startedAt),
        triggeredById: payload.triggeredById,
      });
    },

    onJobComplete: async (
      jobName: string,
      bullJobId: string,
      duration: number,
      logs: JobLogEntry[],
      outcome?: JobOutcomeMeta,
    ) => {
      // Before the run-row write and independent of it: a successful run
      // clears the tenant's failure record even when the run row itself is
      // unreachable (the state-loss return below).
      await isolateTenantFailureWrite(
        () => clearTenantJobFailure(db, jobName, outcome),
        jobName,
        bullJobId,
      );
      await isolateTenantRunWrite(
        () => recordTenantRunOutcome(db, jobName, bullJobId, outcome, "completed"),
        jobName,
        bullJobId,
      );
      const resolved = await resolveRun(bullJobId);
      // skip: state loss between start + complete (worker restart, cache
      // evicted AND DB has no matching bull_job_id). Rare edge case; we
      // drop the completion write rather than forging a run row from
      // scratch — forensics still has the original BullMQ lifecycle.
      if (!resolved) return;
      const { runId, triggeredById } = resolved;
      const payload = runCompletedSchema.parse({
        duration,
        finishedAt: Temporal.Now.instant().toString(),
        logs: logs.map((l) => ({
          level: l.level,
          message: l.message,
          timestamp: l.timestamp.toString(),
        })),
      });
      await updateMany(
        db,
        jobRunsTable,
        {
          status: "completed",
          // Clear stale-sweep error if the run finished after being marked failed.
          error: null,
          // integer column — match onJobFailed's Math.round so fractional
          // BullMQ timings don't trip Postgres integer syntax.
          duration: Math.round(payload.duration),
          finishedAt: parseJobInstant(payload.finishedAt),
          modifiedAt: Temporal.Now.instant(),
          modifiedById: "system",
        },
        { id: runId },
      );
      // skip: empty log batch — the worker ran silent. No child rows to
      // insert; the status update above already recorded completion.
      if (payload.logs.length > 0) {
        const encryptedLogs = await encryptLogMessages(payload.logs, triggeredById);
        await insertMany(
          db,
          jobRunLogsTable,
          encryptedLogs.map((log) => ({
            runId,
            level: log.level,
            message: log.message,
            timestamp: parseJobInstant(log.timestamp),
          })),
        );
      }
      runIdByBullJobId.delete(bullJobId); // immediate cleanup on terminal callback
    },

    onJobFailed: async (
      jobName: string,
      bullJobId: string,
      error: string,
      logs: JobLogEntry[],
      outcome?: JobOutcomeMeta,
    ) => {
      // Mirror of onJobComplete: recorded independently of the run row, so a
      // tenant still learns their job failed if the row is unreachable.
      await isolateTenantFailureWrite(
        () => recordTenantJobFailure(db, jobName, outcome),
        jobName,
        bullJobId,
      );
      await isolateTenantRunWrite(
        () => recordTenantRunOutcome(db, jobName, bullJobId, outcome, "failed"),
        jobName,
        bullJobId,
      );
      const resolved = await resolveRun(bullJobId);
      // skip: same rare state-loss case as in onJobComplete — drop the
      // failure write rather than forge a run row from scratch.
      if (!resolved) return;
      const { runId, triggeredById } = resolved;
      // Read started_at off the row so we can compute duration
      // symmetrically to onJobComplete (which gets duration from the
      // worker). The row already has started_at from onJobStart.
      const row = await fetchOne<{ startedAt: Temporal.Instant }>(db, jobRunsTable, { id: runId });
      const now = Temporal.Now.instant();
      const duration = row
        ? Math.round(Number(now.since(row.startedAt).total({ unit: "millisecond" })))
        : 0;
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
      const encryptedError = await encryptFailureError(payload.error, triggeredById);
      await updateMany(
        db,
        jobRunsTable,
        {
          status: "failed",
          error: encryptedError,
          duration: payload.duration,
          finishedAt: parseJobInstant(payload.finishedAt),
          modifiedAt: now,
          modifiedById: "system",
        },
        { id: runId },
      );
      // skip: empty log batch — mirror of onJobComplete
      if (payload.logs.length > 0) {
        const encryptedLogs = await encryptLogMessages(payload.logs, triggeredById);
        await insertMany(
          db,
          jobRunLogsTable,
          encryptedLogs.map((log) => ({
            runId,
            level: log.level,
            message: log.message,
            timestamp: parseJobInstant(log.timestamp),
          })),
        );
      }
      runIdByBullJobId.delete(bullJobId); // immediate cleanup on terminal callback
    },
  };
}

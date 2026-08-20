import { fetchOne, insertMany, insertOne, updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configuredPiiSubjectKms,
  encryptPiiValueForSubject,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { type Registry, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import type { JobLogEntry, JobMeta, JobRunnerOptions } from "@cosmicdrift/kumiko-framework/jobs";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { runCompletedSchema, runFailedSchema, runStartedSchema } from "./events";
import { parseJobInstant } from "./job-instant";
import { jobRunLogsTable, jobRunsTable } from "./job-run-table";

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

// The run-started payload can carry arbitrary user data; triggeredById
// names its owning user. No event-PII catalog involved (#2243 removed the
// jobRun r.defineEvent registrations, so there is nothing to catalog) —
// the subject is known statically, so we encrypt directly. A null subject
// (system cron runs, recipient-less triggers) stays plaintext: there is no
// user key to shred, mirroring the previous event-pii catalog's own skip
// rule. Absent KMS adapter stays plaintext too (rollout mode, unchanged).
async function encryptStartedPayload(
  payload: string | null,
  triggeredById: string | null,
): Promise<string | null> {
  if (payload === null || triggeredById === null) return payload;
  const kms = configuredPiiSubjectKms();
  if (!kms) return payload;
  return encryptPiiValueForSubject(
    kms,
    { kind: "user", userId: triggeredById },
    payload,
    { requestId: "jobs:job-run-logger" },
    "payload",
  );
}

// Same per-subject encryption as encryptStartedPayload, applied to each
// batched log line's `message` (#2247) before insertMany into
// jobRunLogsTable — that table is unmanaged/direct-write, so there is no
// event-piiFields catalog to lean on here either. "message" is the AAD
// field name and must match the field passed to decryptStoredPii on read
// (detail.query.ts) or decrypt fails loud. Same skip rules as the payload:
// null subject (system/cron runs) and absent KMS (rollout mode) both stay
// plaintext.
async function encryptLogMessages<T extends { readonly message: string }>(
  logs: readonly T[],
  triggeredById: string | null,
): Promise<T[]> {
  if (triggeredById === null) return [...logs];
  const kms = configuredPiiSubjectKms();
  if (!kms) return [...logs];
  return Promise.all(
    logs.map(async (log) => ({
      ...log,
      message: await encryptPiiValueForSubject(
        kms,
        { kind: "user", userId: triggeredById },
        log.message,
        { requestId: "jobs:job-run-logger" },
        "message",
      ),
    })),
  );
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
    onJobStart: async (jobName: string, bullJobId: string, meta: JobMeta) => {
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
      _jobName: string,
      bullJobId: string,
      duration: number,
      logs: JobLogEntry[],
    ) => {
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
          duration: payload.duration,
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
      _jobName: string,
      bullJobId: string,
      error: string,
      logs: JobLogEntry[],
    ) => {
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
      await updateMany(
        db,
        jobRunsTable,
        {
          status: "failed",
          error: payload.error,
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

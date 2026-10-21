/// <reference types="temporal-polyfill/global" preserve="true" />

import type { WriteOrigin } from "@cosmicdrift/kumiko-types/event-store-types";
import { escapeHatchFor } from "@cosmicdrift/kumiko-types/handlers";
import type { JobsOptions } from "bullmq";
import { DelayedError, Queue, UnrecoverableError, Worker } from "bullmq";
import { Redis } from "ioredis";
import { requestContext } from "../api/request-context.ts";
import type { DbConnection, DbRow } from "../db/connection.ts";
import { createTenantDb, createUncheckedSystemDb } from "../db/tenant-db.ts";
import { createDerivativesContext } from "../derivatives/derivatives-context.ts";
import { bridgeStub } from "../engine/bridge-stub.ts";
import { qnScope } from "../engine/qualified-name.ts";
import { createSystemUser } from "../engine/system-user.ts";
import type {
  DispatchWriteRef,
  JobContext,
  JobDeferral,
  JobDefinition,
  JobRunIn,
  JobTriggerEvent,
  MemberReader,
  SessionUser,
  TenantId,
} from "../engine/types/index.ts";
import { SYSTEM_TENANT_ID } from "../engine/types/index.ts";
import { InternalError } from "../errors/index.ts";
import { createTenantFileContext } from "../files/file-handle.ts";
import { createFallbackLogger, scrubLogText } from "../logging/index.ts";
import type { Tracer } from "../observability/index.ts";
import {
  createEscapeHatchProcessDedup,
  createEscapeHatchReporter,
  createEscapeHatchReportWindow,
  createMetricsForFactory,
  emitJobLastSuccess,
  flushEscapeHatchAudits,
  getFallbackTracer,
  registerStandardMetrics,
  withEscapeHatchAuditScope,
} from "../observability/index.ts";
import { configAccessorFactoryOf } from "../pipeline/config-accessor-factory.ts";
import type { DistributedLock } from "../pipeline/distributed-lock.ts";
import { createDistributedLock } from "../pipeline/distributed-lock.ts";
import { RedisKeys } from "../pipeline/redis-keys.ts";
import { createGatedIdentitySwitch } from "../pipeline/system-identity-switch.ts";
import { buildPersonalDataGate, parseWriteOrigin } from "../pipeline/write-origin.ts";
import { cronRepeatOptions } from "./cron-repeat-options.ts";
import {
  BOOT_GATE_SLOW_WARN_MS,
  BOOT_REDIS_TIMEOUT_MS,
  buildRetryBullOpts,
  COMPLETED_JOB_RETENTION_AGE_SEC,
  captureTraceContext,
  createCrossTenantReads,
  createJobLogger,
  DEFAULT_MAX_DEFERS,
  DEFER_BACKOFF_MAX_DOUBLINGS,
  DEFER_COUNT_KEY,
  DEFER_DELAY_CAP_MS,
  FAILED_JOB_RETENTION_AGE_SEC,
  HANDLER_DEFER_COUNT_KEY,
  isJobTriggerEvent,
  jobSubjectKey,
  maxRetryWindowMs,
  missingDbProxy,
  parseRedisOpts,
  payloadMatchesTriggerFilter,
  priorAttemptsOf,
  readTraceContext,
  resolveJobTz,
  STOP_QUEUE_READY_TIMEOUT_MS,
  stampGatedWriteOrigin,
  startQueueDepthPolling,
  TRACE_CONTEXT_KEY,
  tenantFailureMessageKey,
  timeoutReject,
} from "./job-runner-helpers.ts";
import {
  ACTIVE_TENANT_IDS_QUERY_NAME,
  bootJobIdForJobName,
  DEFAULT_QUEUE_NAME_PREFIX,
  markSchedulersSeen,
  ORPHAN_SCHEDULER_GRACE_MS,
  perTenantChildJobId,
  queueNameFor,
  removeOrphanJobSchedulers,
  schedulerIdForJobName,
} from "./job-runner-schedulers.ts";
import type {
  JobLogEntry,
  JobMeta,
  JobOutcomeMeta,
  JobRunner,
  JobRunnerOptions,
} from "./job-runner-types.ts";
import { resolveMaxPerTenant } from "./max-per-tenant.ts";

export { serializeJobSubject } from "./job-runner-helpers.ts";
export {
  bootJobIdForJobName,
  ORPHAN_SCHEDULER_GRACE_MS,
  schedulerIdForJobName,
} from "./job-runner-schedulers.ts";
export type {
  JobDroppedMeta,
  JobLogEntry,
  JobMeta,
  JobOutcomeMeta,
  JobQueuedMeta,
  JobRunner,
  JobRunnerOptions,
  JobSubjectValue,
} from "./job-runner-types.ts";

export function createJobRunner(options: JobRunnerOptions): JobRunner {
  const { registry, context, redisUrl, consumerLane } = options;
  const queueNamePrefix = options.queueNamePrefix ?? DEFAULT_QUEUE_NAME_PREFIX;
  const bootRedisTimeoutMs = options.bootRedisTimeoutMs ?? BOOT_REDIS_TIMEOUT_MS;
  const schedulerSeenRefreshMs = options.schedulerSeenRefreshMs ?? ORPHAN_SCHEDULER_GRACE_MS / 4;
  const redisOpts = parseRedisOpts(redisUrl);
  // Use the context's tracer when present (observability-provider injected at
  // boot); otherwise noop so dispatch/handleJob stay zero-cost without config.
  const tracer: Tracer = context.tracer ?? getFallbackTracer();
  const errorLogger = createFallbackLogger("job-runner", context.log);
  // The last-success gauge throws if its metric was never registered; the runner
  // must not depend on buildServer having done it first. Idempotent.
  if (context.meter) registerStandardMetrics(context.meter);
  // Instance-scoped, not module-level: each runner (and each test) audits a system cron's declared hatch once.
  const escapeHatchReportWindow = createEscapeHatchReportWindow();
  const systemCronEscapeHatchDedup = createEscapeHatchProcessDedup([
    "unsafe-raw",
    "global-write",
    "cross-tenant-read",
  ]);
  // Set at the top of stop() — a graceful shutdown closes the redis/BullMQ
  // clients itself, which fires the exact same 'error' listeners below with
  // an expected "Connection is closed." Downgrading to debug once stopping
  // is true keeps those out of error-rate alerts without losing them.
  let stopping = false;

  // Default for perTenant fan-out when the caller didn't supply
  // options.getActiveTenantIds: if the tenant feature is mounted (its
  // active-tenant-ids query is in the registry), resolve tenants through
  // that instead of forcing every app to wire the option by hand. Same
  // hand-built-context pattern delivery-service.ts uses to invoke a
  // registered handler without a live dispatcher — no dispatcher exists yet
  // at createJobRunner() time, and this call runs with system-level access
  // by construction, so going through the dispatcher's per-request identity
  // checks would add nothing.
  function defaultGetActiveTenantIds(): (() => Promise<TenantId[]>) | undefined {
    const handler = registry.getQueryHandler(ACTIVE_TENANT_IDS_QUERY_NAME);
    const db = context.db as DbConnection | undefined; // @cast-boundary db-operator
    if (!handler || !db) return undefined;
    return async () => {
      const systemUser = createSystemUser(SYSTEM_TENANT_ID);
      const systemModeDb = createTenantDb({ db, tenantId: SYSTEM_TENANT_ID, mode: "system" });
      const reportEscapeHatch = createEscapeHatchReporter({
        handler: ACTIVE_TENANT_IDS_QUERY_NAME,
        tenantId: SYSTEM_TENANT_ID,
        actor: systemUser.id,
        sink: context._escapeHatchAuditSink,
        log: errorLogger,
        window: escapeHatchReportWindow,
      });
      const result = await handler.handler(
        { type: ACTIVE_TENANT_IDS_QUERY_NAME, payload: {}, user: systemUser },
        {
          db: systemModeDb,
          dbOutsideTransaction: systemModeDb,
          systemDb: createUncheckedSystemDb(systemModeDb, undefined, reportEscapeHatch),
          registry,
          ...bridgeStub(),
        },
      );
      if (!Array.isArray(result) || result.some((id) => typeof id !== "string")) {
        throw new InternalError({
          message: `${ACTIVE_TENANT_IDS_QUERY_NAME} must return string[] of tenant ids`,
        });
      }
      // @cast-boundary engine-payload — checked to be string[] above; TenantId is a brand
      return result as TenantId[];
    };
  }
  const getActiveTenantIds = options.getActiveTenantIds ?? defaultGetActiveTenantIds();

  const allJobs = registry.getAllJobs();

  function positiveIntRetentionSec(
    value: number | undefined,
    fallback: number,
    label: string,
  ): number {
    const resolved = value ?? fallback;
    if (!Number.isInteger(resolved) || resolved <= 0) {
      throw new Error(
        `job-runner: jobRetention.${label} must be a positive integer, got ${resolved}`,
      );
    }
    return resolved;
  }
  const completedAgeSec = positiveIntRetentionSec(
    options.jobRetention?.completedAgeSec,
    COMPLETED_JOB_RETENTION_AGE_SEC,
    "completedAgeSec",
  );
  const failedAgeSec = positiveIntRetentionSec(
    options.jobRetention?.failedAgeSec,
    FAILED_JOB_RETENTION_AGE_SEC,
    "failedAgeSec",
  );

  // perTenant child dedup (perTenantChildJobId) only holds as long as the
  // children are still in Redis when a wrapper retry re-derives their ids,
  // which requires the completed-job retention to outlast the wrapper's own
  // worst-case retry window. Enforced here, before any Redis connection
  // opens below, so a misconfigured job fails boot loudly instead of
  // silently losing dedup in prod.
  for (const [name, jobDef] of allJobs) {
    if (!jobDef.perTenant) continue;
    const windowMs = maxRetryWindowMs(jobDef);
    if (windowMs >= completedAgeSec * 1000) {
      throw new Error(
        `job-runner: perTenant job "${name}" has a retry window of ${windowMs}ms, which is >= ` +
          `the completed-job retention (${completedAgeSec}s). Child dedup relies on children ` +
          "staying in Redis for the whole retry window — lower retries/backoff or raise " +
          "jobRetention.completedAgeSec.",
      );
    }
  }

  // Resolve the lane for a job — "worker" is the default because that's the
  // sensible prod lane (heavy async off the request path). Jobs that opted
  // into "api" must have been validated at registry boot already.
  function laneForJob(def: { readonly runIn?: JobRunIn | undefined }): JobRunIn {
    return def.runIn ?? "worker";
  }

  // Sequential coordination: BullMQ OSS has no `group`, so we serialise
  // same-name jobs ourselves with a per-name Redis lock. Only built when at
  // least one job actually requested it — keeps the no-sequential boot path
  // free of the extra Redis client. Scoped under the consumer lane so two
  // runners on different lanes cannot collide on the same lock-key for
  // unrelated jobs.
  const hasSequential = [...allJobs.values()].some((def) => def.concurrency === "sequential");
  let lockRedis: Redis | null = null;
  let sequentialLock: DistributedLock | null = null;
  if (hasSequential) {
    lockRedis = new Redis(redisOpts);
    // Without a listener, a post-close 'error' (e.g. a teardown-race
    // "Connection is closed") is unhandled and crashes the process — in
    // bun:test it gets attributed to whichever test happens to run next
    // (fw#1805).
    lockRedis.on("error", (err) => {
      const log = stopping ? errorLogger.debug : errorLogger.error;
      log("lock redis connection error", { error: err.message });
    });
    const lockScope = consumerLane ?? "enqueue";
    // Scoped by queueNamePrefix like the queues themselves, so runners
    // isolated by prefix on a shared Redis don't contend for the same lock.
    sequentialLock = createDistributedLock(
      lockRedis,
      `${RedisKeys.lock}seq:${queueNamePrefix}:${lockScope}:`,
    );
  }
  // Default lock-TTL for sequential jobs that didn't declare a timeout.
  // 5 minutes matches BullMQ's default stalledInterval — long enough for
  // any reasonable handler, short enough that a crashed worker recovers
  // without manual intervention.
  const SEQUENTIAL_DEFAULT_TTL_SEC = 305;
  // How long to wait before re-trying a busy sequential lock. Short enough
  // to feel responsive, long enough that we don't hammer Redis.
  const SEQUENTIAL_RETRY_DELAY_MS = 200;

  // Two queue-clients — one per lane. Every runner holds both, regardless of
  // its own consumerLane, so dispatch()/handleEvent() always write to the
  // queue matching the target job's runIn. Client-creation is cheap (shared
  // ioredis connection via bullmq), so this doesn't scale with number of
  // processes.
  // Queue-wide, age-only retention (see COMPLETED_JOB_RETENTION_AGE_SEC
  // above for why) — merged into every add()/addBulk()/upsertJobScheduler()
  // template on both lanes.
  const jobRetentionOpts: Pick<JobsOptions, "removeOnComplete" | "removeOnFail"> = {
    removeOnComplete: { age: completedAgeSec },
    removeOnFail: { age: failedAgeSec },
  };
  const queues: Readonly<Record<JobRunIn, Queue>> = {
    api: new Queue(queueNameFor(queueNamePrefix, "api"), {
      connection: redisOpts,
      defaultJobOptions: jobRetentionOpts,
    }),
    worker: new Queue(queueNameFor(queueNamePrefix, "worker"), {
      connection: redisOpts,
      defaultJobOptions: jobRetentionOpts,
    }),
  };
  // Same unhandled-'error'-crash hazard as lockRedis above, just via
  // BullMQ's internal ioredis client (fw#1805).
  for (const queue of Object.values(queues)) {
    queue.on("error", (err) => {
      const log = stopping ? errorLogger.debug : errorLogger.error;
      log("queue redis connection error", { error: err.message });
    });
  }
  let worker: Worker | null = null;
  let queueDepthTimer: ReturnType<typeof setInterval> | null = null;
  let schedulerSeenTimer: ReturnType<typeof setInterval> | null = null;
  let schedulerStampPending = false;
  // A timed-out gate is abandoned, not aborted (the job context carries no
  // AbortSignal); stop() waits for it so it cannot write after the shutdown.
  const abandonedBootGates = new Set<Promise<void>>();
  // Forward reference to the runner's own API, exposed on the job-handler ctx
  // so a handler can dispatch a follow-up job (job→job chaining, e.g.
  // delivery.render → delivery.send). Assigned just before return; reads happen
  // at job-execution time (after start()), so it is always defined by then.
  let selfRunner: JobRunner | undefined;
  // Set by attachDispatcher() once the boot-level dispatcher exists.
  // JobContext.write/writeAs/queryAs throw until this is set — see JobContext doc.
  let dispatchWriteRef: DispatchWriteRef | undefined;

  // Counts active + waiting jobs with this name for this tenant across
  // BOTH lane queues. Jobs with the same name should only live in one
  // lane (jobDef.runIn is static), but walking both is cheap and avoids
  // a subtle bug if someone ever reassigns a job to a different lane
  // between deploys while old queue contents are still draining.
  // `activeOnly` + `self` serve the defer check, which runs inside the job being
  // counted: it must not see waiting jobs or itself, and only counts jobs that
  // became active before it. Without that order, workers that fetch a burst of
  // jobs together all see each other as active and all defer, again and again.
  async function isOverPerTenantLimit(
    jobName: string,
    tenantId: string,
    max: number,
    scope: {
      readonly activeOnly?: boolean;
      readonly self?: { readonly id: string | undefined; readonly processedOn: number | undefined };
    } = {},
  ): Promise<boolean> {
    const results = await Promise.all([
      queues.api.getActive(),
      queues.worker.getActive(),
      ...(scope.activeOnly ? [] : [queues.api.getWaiting(), queues.worker.getWaiting()]),
    ]);
    let count = 0;
    for (const list of results) {
      for (const j of list) {
        if (j.name !== jobName) continue;
        if (scope.self && !isActiveBefore(j, scope.self)) continue;
        const t = (j.data as { _tenantId?: string } | undefined)?._tenantId; // @cast-boundary dynamic-key
        if (t === tenantId) {
          count += 1;
          if (count >= max) return true;
        }
      }
    }
    return false;
  }

  function isActiveBefore(
    other: { readonly id?: string | undefined; readonly processedOn?: number | undefined },
    self: { readonly id: string | undefined; readonly processedOn: number | undefined },
  ): boolean {
    if (other.id === self.id) return false;
    if (self.processedOn === undefined) return true;
    const otherProcessedOn = other.processedOn ?? 0;
    if (otherProcessedOn !== self.processedOn) return otherProcessedOn < self.processedOn;
    return (other.id ?? "") < (self.id ?? "");
  }

  // Growing delay bounds Redis and worker load while one tenant has a large
  // backlog: every deferred job would otherwise be re-checked every deferMs.
  function deferDelayMs(deferMs: number, deferCount: number): number {
    const grown = Math.min(
      deferMs * 2 ** Math.min(deferCount, DEFER_BACKOFF_MAX_DOUBLINGS),
      DEFER_DELAY_CAP_MS,
    );
    return grown + Math.floor(Math.random() * deferMs);
  }

  // Structural instead of BullMQ's `Job` so boot gates can invoke the same
  // execution path inline. A real `Job` stays assignable, so handleJob is
  // still a valid BullMQ Processor.
  type JobInvocation = {
    readonly id?: string | undefined;
    readonly name: string;
    readonly data: Record<string, unknown>;
    readonly attemptsMade: number;
    /** False for inline invocations (boot gates): nothing retries a throw. */
    readonly retryable?: boolean;
    readonly processedOn?: number | undefined;
    moveToDelayed?(timestamp: number, token?: string): Promise<void>;
    updateData?(data: Record<string, unknown>): Promise<void>;
  };

  function isJobDeferral(value: unknown): value is JobDeferral {
    return (
      typeof value === "object" &&
      value !== null &&
      "kind" in value &&
      value.kind === "job-deferral"
    );
  }

  function priorDeferCountOf(data: Record<string, unknown>, key: string): number {
    const prior = data[key];
    return typeof prior === "number" ? prior : 0;
  }

  // Only err.message, never payload or the logs array: job payloads can carry PII.
  function logFailedAttempt(entry: {
    readonly job: string;
    readonly jobId: string;
    readonly attempt: number;
    readonly finalAttempt: boolean;
    readonly err: unknown;
  }): void {
    errorLogger.error("job failed", {
      job: entry.job,
      jobId: entry.jobId,
      attempt: entry.attempt,
      // BullMQ never retries an UnrecoverableError, whatever attempts remain.
      final: entry.finalAttempt || entry.err instanceof UnrecoverableError,
      error: scrubLogText(entry.err instanceof Error ? entry.err.message : String(entry.err)),
      ...(entry.err instanceof Error &&
        entry.err.stack && { stack: scrubLogText(entry.err.stack) }),
    });
  }

  async function reportPreRunFailure(
    jobName: string,
    bullJob: JobInvocation,
    err: unknown,
  ): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    await options.onJobFailed?.(jobName, bullJob.id ?? "unknown", message, [
      { level: "error", message, timestamp: Temporal.Now.instant() },
    ]);
  }

  function handlerPayloadOf(data: Record<string, unknown>): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (!k.startsWith("_")) payload[k] = v;
    }
    return payload;
  }

  function tenantIdOfJobData(data: Record<string, unknown>): string {
    return (
      (data["_tenantId"] as string | undefined) ?? // @cast-boundary dynamic-key
      (data["tenantId"] as string | undefined) ?? // @cast-boundary dynamic-key
      SYSTEM_TENANT_ID
    );
  }

  // Tenant-visible queued state. A callback or subject problem must never fail
  // the enqueue; a bad subject config surfaces as a failed run instead.
  async function announceQueued(
    jobName: string,
    jobDef: JobDefinition,
    bullJobId: string | undefined,
    data: Record<string, unknown>,
  ): Promise<void> {
    const declaration = jobDef.tenantVisibleRun;
    // skip: job did not opt in, no logger wired, or BullMQ returned no id
    if (!declaration || !options.onJobQueued || bullJobId === undefined) return;
    const tenantId = tenantIdOfJobData(data);
    // skip: tenant-less run — no tenant-scoped query could ever read it
    if (tenantId === SYSTEM_TENANT_ID) return;
    try {
      const subject = jobSubjectKey(
        jobName,
        handlerPayloadOf(data),
        declaration.subjectFields,
        "tenantVisibleRun",
      );
      await options.onJobQueued(jobName, bullJobId, { tenantId, subject });
    } catch (err) {
      errorLogger.warn("tenant-visible queued state not recorded", {
        job: jobName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function announceDropped(
    jobName: string,
    jobDef: JobDefinition,
    bullJobId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    // skip: job did not opt in or no logger wired
    if (!jobDef.tenantVisibleRun || !options.onJobDropped) return;
    const tenantId = tenantIdOfJobData(data);
    // skip: tenant-less run — announceQueued never recorded a row for it
    if (tenantId === SYSTEM_TENANT_ID) return;
    try {
      await options.onJobDropped(jobName, bullJobId, { tenantId });
    } catch (err) {
      errorLogger.warn("tenant-visible queued state not cleared", {
        job: jobName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleJob(bullJob: JobInvocation, token?: string): Promise<void> {
    const rawName = bullJob.name;

    // Handle perTenant dispatch jobs — fan out to one job per tenant. The
    // fan-out re-enqueues into the lane the actual job is assigned to;
    // the _perTenant wrapper itself always lives in the consumer-lane
    // (it's picked up by this runner's own worker).
    if (rawName.startsWith("_perTenant:")) {
      const actualName = rawName.slice("_perTenant:".length);
      // These throws happen before runInSpan, so its onJobFailed never sees them
      // and a drained test stack would stay green over a fan-out that never ran.
      try {
        if (!getActiveTenantIds) {
          if (registry.getQueryHandler(ACTIVE_TENANT_IDS_QUERY_NAME)) {
            throw new Error(
              `perTenant job "${actualName}": the tenant feature is mounted but the job runner has no ` +
                "`context.db`: pass a DbConnection in the runner context or supply options.getActiveTenantIds",
            );
          }
          throw new Error(
            `perTenant job "${actualName}" requires either options.getActiveTenantIds or the ` +
              `tenant feature mounted (it registers "${ACTIVE_TENANT_IDS_QUERY_NAME}", which the ` +
              "framework uses to resolve active tenants on its own)",
          );
        }
        const actualDef = allJobs.get(actualName);
        if (!actualDef) {
          throw new Error(`Unknown job: ${actualName}`);
        }
        const tenantIds = await getActiveTenantIds();
        const targetQueue = queues[laneForJob(actualDef)];
        // wrapperJobId is only absent for a Job BullMQ somehow never assigned
        // an id to (not observed in practice) — falling back to a constant
        // there would collide every such run's children onto the same ids
        // and silently swallow later runs as "duplicates", which is worse
        // than the duplicate this is meant to prevent. Skip id-based dedup
        // for that edge case instead: enqueue plainly, same as before.
        const wrapperJobId = bullJob.id;
        for (const tenantId of tenantIds) {
          const childData = { ...bullJob.data, _tenantId: tenantId };
          const child = await targetQueue.add(actualName, childData, {
            ...buildRetryBullOpts(actualDef),
            // Dedup over wrapper retries only holds as long as the children
            // stay in Redis for the wrapper's whole retry window — see the
            // COMPLETED_JOB_RETENTION_AGE_SEC invariant check above.
            ...(wrapperJobId !== undefined
              ? { jobId: perTenantChildJobId(wrapperJobId, tenantId) }
              : {}),
          });
          await announceQueued(actualName, actualDef, child.id, childData);
        }
      } catch (err) {
        // A retry may still succeed, and a succeeding wrapper reports no completion
        // that could clear an earlier failure, so only the final attempt is reported.
        const retries = allJobs.get(actualName)?.retries ?? 0;
        const finalAttempt = bullJob.attemptsMade + 1 >= retries + 1;
        logFailedAttempt({
          job: rawName,
          jobId: bullJob.id ?? "unknown",
          attempt: bullJob.attemptsMade + 1,
          finalAttempt,
          err,
        });
        if (finalAttempt) {
          await reportPreRunFailure(rawName, bullJob, err);
        }
        throw err;
      }
      // skip: fan-out dispatcher job, per-tenant children enqueued
      return;
    }

    const jobName = rawName;
    const jobDef = allJobs.get(jobName);
    if (!jobDef) {
      const err = new Error(`Unknown job: ${jobName}`);
      // Final regardless of attempts left: a retry cannot make the job exist.
      logFailedAttempt({
        job: jobName,
        jobId: bullJob.id ?? "unknown",
        attempt: bullJob.attemptsMade + 1,
        finalAttempt: true,
        err,
      });
      await reportPreRunFailure(jobName, bullJob, err);
      throw err;
    }

    // maxPerTenant defer: checked before anything is recorded for this run, so a
    // deferred pickup leaves no span, run-log entry or failure trace and does not
    // consume an attempt (moveToDelayed + DelayedError, not a retry).
    const maxPerTenant = resolveMaxPerTenant(jobDef);
    const deferTenantId = bullJob.data["_tenantId"];
    if (
      maxPerTenant?.onLimit === "defer" &&
      typeof deferTenantId === "string" &&
      token !== undefined &&
      bullJob.moveToDelayed &&
      (await isOverPerTenantLimit(jobName, deferTenantId, maxPerTenant.limit, {
        activeOnly: true,
        self: { id: bullJob.id, processedOn: bullJob.processedOn },
      }))
    ) {
      const deferCount = priorDeferCountOf(bullJob.data, DEFER_COUNT_KEY);
      await bullJob.updateData?.({ ...bullJob.data, [DEFER_COUNT_KEY]: deferCount + 1 });
      await bullJob.moveToDelayed(
        Date.now() + deferDelayMs(maxPerTenant.deferMs, deferCount),
        token,
      );
      throw new DelayedError();
    }

    // Sequential gate: try to claim the per-name lock. If another worker
    // (or this worker on a different bullJob) holds it, re-enqueue with a
    // small delay and exit *successfully* — using throw would burn the
    // job's retry budget and pollute failure metrics, but a re-enqueue
    // looks like an ordinary handoff to BullMQ.
    let sequentialToken: string | null = null;
    if (jobDef.concurrency === "sequential" && sequentialLock) {
      const ttlSec = jobDef.timeout
        ? Math.ceil(jobDef.timeout / 1000) + 5
        : SEQUENTIAL_DEFAULT_TTL_SEC;
      sequentialToken = await sequentialLock.acquire(jobName, { ttlSeconds: ttlSec });
      if (!sequentialToken) {
        // Re-enqueue onto the job's own lane-queue. In practice that's the
        // same queue the worker just picked from (since only the consuming
        // lane runs handleJob at all), but route explicitly — no implicit
        // coupling to "whichever queue the caller happened to be on".
        // Attempts already spent travel in _priorAttempts so a lock conflict
        // on a retry cannot hand out a fresh budget and exceed `retries`.
        const priorAttempts = priorAttemptsOf(bullJob.data) + bullJob.attemptsMade;
        const requeuedData = { ...bullJob.data, _priorAttempts: priorAttempts };
        const requeued = await queues[laneForJob(jobDef)].add(jobName, requeuedData, {
          delay: SEQUENTIAL_RETRY_DELAY_MS,
          ...buildRetryBullOpts(jobDef, priorAttempts),
        });
        if (bullJob.id !== undefined && bullJob.id !== requeued.id) {
          await announceDropped(jobName, jobDef, bullJob.id, bullJob.data);
        }
        await announceQueued(jobName, jobDef, requeued.id, requeuedData);
        // skip: lock taken, work re-enqueued with delay, current invocation done
        return;
      }
    }

    const jobId = bullJob.id ?? "unknown";
    const startTime = Date.now();
    const logs: JobLogEntry[] = [];

    // Extract meta from job data. `attempt` is BullMQ's own counter
    // (1-based on the first run, incremented on each retry) — threading
    // it through lets the logger tag the run-started event with the
    // retry number, so audit queries distinguish fresh from retry runs
    // without peeking at BullMQ internals.
    const rawData = bullJob.data as DbRow;
    const attempt = bullJob.attemptsMade + 1 + priorAttemptsOf(rawData);
    const meta: JobMeta = {
      triggeredById: rawData["_triggeredById"] as string | undefined, // @cast-boundary dynamic-key
      payload: rawData["_payload"] as string | undefined, // @cast-boundary dynamic-key
      attempt,
    };

    // Build handler payload (without internal meta fields)
    const payload = handlerPayloadOf(rawData);

    // Determine tenantId and triggeredBy from meta
    const tenantId = tenantIdOfJobData(rawData);
    const triggeredById = (rawData["_triggeredById"] as string | undefined) ?? null; // @cast-boundary dynamic-key

    // Tenant-visible failure record (JobDefinition.tenantVisibleFailure). The
    // subject is read from the handler payload, so it is resolved here where
    // the payload is built, not in the callbacks.
    const tenantVisibleDecl = jobDef.tenantVisibleFailure;
    const tenantVisibleRunDecl = jobDef.tenantVisibleRun;
    // A bad subject config must surface as a failed run, so it is thrown from
    // inside runInSpan below instead of here, before any run record exists.
    let tenantVisibleSubject: string | null = null;
    let tenantVisibleRunSubject: string | null = null;
    let subjectConfigError: Error | undefined;
    if (tenantVisibleRunDecl) {
      try {
        tenantVisibleRunSubject = jobSubjectKey(
          jobName,
          payload,
          tenantVisibleRunDecl.subjectFields,
          "tenantVisibleRun",
        );
      } catch (err) {
        subjectConfigError = err instanceof Error ? err : new Error(String(err));
      }
    }
    if (tenantVisibleDecl && !subjectConfigError) {
      try {
        tenantVisibleSubject = jobSubjectKey(
          jobName,
          payload,
          tenantVisibleDecl.subjectFields,
          "tenantVisibleFailure",
        );
      } catch (err) {
        subjectConfigError = err instanceof Error ? err : new Error(String(err));
      }
    }
    // BullMQ stops retrying once attemptsMade reaches the configured attempts
    // (`retries + 1`), so this is the attempt whose failure is final.
    const finalAttempt = bullJob.retryable === false || attempt >= (jobDef.retries ?? 0) + 1;
    const outcomeMeta = (messageKey: string | null, unrecoverable = false): JobOutcomeMeta => ({
      tenantId,
      // BullMQ never retries an UnrecoverableError, whatever attempts are left.
      finalAttempt: finalAttempt || unrecoverable,
      ...(tenantVisibleDecl &&
        !subjectConfigError && {
          tenantVisible: { subject: tenantVisibleSubject, messageKey },
        }),
      ...(tenantVisibleRunDecl &&
        !subjectConfigError && { tenantVisibleRun: { subject: tenantVisibleRunSubject } }),
    });

    // Carry `_triggerName` from rawData when set — handleEvent injects it on
    // multi-trigger dispatch; exposed as jobContext.triggerName so handlers
    // don't dig through the raw payload themselves.
    const triggerName = rawData["_triggerName"] as string | undefined; // @cast-boundary dynamic-key

    // Same carry-through for `_triggerEvent` — handleEvent injects it when
    // the job-trigger event consumer supplied the stored event that fired
    // this run (see createJobTriggerEventConsumer).
    const rawTriggerEvent = rawData["_triggerEvent"];
    const triggerEvent = isJobTriggerEvent(rawTriggerEvent) ? rawTriggerEvent : undefined;

    // Absent = legacy or ungated root; present but invalid fails the run closed.
    const rawWriteOrigin = rawData["_writeOrigin"]; // @cast-boundary dynamic-key
    let jobOrigin: WriteOrigin | undefined;
    let writeOriginInvalid = false;
    if (rawWriteOrigin !== undefined) {
      const parsed = parseWriteOrigin(rawWriteOrigin);
      if (parsed) {
        jobOrigin = { ...parsed, viaJob: jobName };
      } else {
        writeOriginInvalid = true;
      }
    }
    const jobPersonalDataGate = jobOrigin ? buildPersonalDataGate(registry, jobOrigin) : undefined;

    // Mirror dispatch-shared.ts buildHandlerContext: ctx.files must resolve
    // through the same _fileProviderResolver for jobs as for write-handlers,
    // otherwise event-triggered jobs silently get an unresolved ctx.files.
    const fileResolver = context._fileProviderResolver;
    const files = fileResolver ? createTenantFileContext(fileResolver, tenantId) : context.files;
    const jobSystemUser = createSystemUser(tenantId);
    // Same buildHandlerContext parity as ctx.files above: ctx.notify/ctx.config
    // must resolve for jobs the same way they do for write-handlers, or an
    // app-author job calling ctx.notify(...)/ctx.config(...) hits a TypeError
    // at runtime the write-handler path never would (framework#1532).
    const notify = context._notifyFactory?.(
      jobSystemUser,
      tenantId,
      selfRunner,
      undefined,
      context._fileProviderResolver,
    );
    const configDb = context.db as DbConnection | undefined; // @cast-boundary db-operator
    // Shared by the config accessor and ctx.derivatives below — both need the
    // same tenant-scoped db, and building it twice would let the two calls
    // drift apart. Always "system" mode regardless of the job's own
    // systemScope() status (pre-existing, not something this change alters)
    // — isSystemJob below is what actually keeps ctx.systemDb off a
    // non-system job; it is the only thing standing between this db and an
    // unchecked cross-tenant escape hatch for such a job. Gated like jobDb so
    // ctx.systemDb, built from it, is gated too.
    const tenantScopedDb = configDb
      ? createTenantDb({
          db: configDb,
          tenantId,
          mode: "system",
          grants: {
            projectionRegistry: registry,
            ...(jobPersonalDataGate && { personalDataGate: jobPersonalDataGate }),
          },
        })
      : undefined;
    const isSystemJob = registry.isJobSystemScoped(jobName);
    // One reporter for ctx.systemDb and ctx.db.unsafeRaw() so both dedupe in the same window.
    const isSystemCronRun =
      triggeredById === null && jobDef.escapeHatch !== undefined && "cron" in jobDef.trigger;
    const reportEscapeHatch = createEscapeHatchReporter({
      handler: jobName,
      tenantId,
      actor: jobSystemUser.id,
      sink: context._escapeHatchAuditSink,
      log: errorLogger,
      window: escapeHatchReportWindow,
      ...(triggeredById !== null && { caller: triggeredById }),
      ...(isSystemCronRun && { processDedup: systemCronEscapeHatchDedup }),
      ...(context.meter && { meter: context.meter }),
    });
    const systemDb =
      isSystemJob && tenantScopedDb
        ? createUncheckedSystemDb(tenantScopedDb, undefined, reportEscapeHatch)
        : undefined;
    const jobDb = configDb
      ? createTenantDb({
          db: configDb,
          tenantId,
          mode: "tenant",
          tracer: context.tracer,
          meter: context.meter,
          grants: {
            unsafeRaw: escapeHatchFor(jobDef.escapeHatch, "unsafeRaw"),
            globalWrites: escapeHatchFor(jobDef.escapeHatch, "globalWrites"),
            report: reportEscapeHatch,
            projectionRegistry: registry,
            ...(jobPersonalDataGate && { personalDataGate: jobPersonalDataGate }),
          },
        })
      : undefined;
    const crossTenantReadsReason = escapeHatchFor(jobDef.escapeHatch, "unsafeRaw")?.reason;
    const crossTenantReads =
      tenantScopedDb && crossTenantReadsReason !== undefined
        ? createCrossTenantReads(tenantScopedDb, crossTenantReadsReason, reportEscapeHatch)
        : undefined;
    const configFactory = configAccessorFactoryOf(context);
    const config =
      configFactory && tenantScopedDb
        ? configFactory({
            user: { id: jobSystemUser.id, tenantId },
            db: tenantScopedDb,
            secrets: context.secrets,
          })
        : undefined;
    // Mirror dispatch-shared.ts: ctx.derivatives needs files+db, same
    // tenant-scoped db the config accessor above uses.
    const derivatives =
      files && tenantScopedDb
        ? createDerivativesContext({
            files,
            registry,
            db: tenantScopedDb,
            tenantId,
          })
        : context.derivatives;
    // Per-job-run reader, created lazily on queryAsMember's first call and
    // cached for the rest of this run.
    let memberReader: MemberReader | undefined;
    const identitySwitchHatch = escapeHatchFor(jobDef.escapeHatch, "systemIdentity");
    const identitySwitchGrantReason =
      identitySwitchHatch?.reason ??
      (isSystemJob ? `r.systemScope() feature of job "${jobName}"` : undefined);
    const ungatedQueryAs = (user: SessionUser, qn: string, payload: unknown) => {
      if (!dispatchWriteRef) {
        throw new Error(
          "JobContext.queryAs called before dispatcher attached — call attachDispatcher() first",
        );
      }
      return dispatchWriteRef.queryAs(user, qn, payload, jobOrigin);
    };
    const gatedIdentitySwitch = createGatedIdentitySwitch(
      `job "${jobName}"`,
      jobSystemUser,
      isSystemJob || identitySwitchHatch !== undefined,
      {
        queryAs: ungatedQueryAs,
        writeAs: async (user: SessionUser, qn: string, payload: unknown) => {
          if (!dispatchWriteRef) {
            throw new Error(
              "JobContext.writeAs called before dispatcher attached — call attachDispatcher() first",
            );
          }
          return dispatchWriteRef.write(user, qn, payload, jobOrigin);
        },
      },
      { reason: identitySwitchGrantReason, report: reportEscapeHatch },
    );
    const jobContextWithoutTz: Omit<JobContext, "tz"> = {
      defer: (delayMs) => {
        if (!Number.isInteger(delayMs) || delayMs <= 0) {
          throw new RangeError(
            `Job "${jobName}": ctx.defer needs a positive integer delay in ms (got ${delayMs})`,
          );
        }
        if (token === undefined || !bullJob.moveToDelayed) {
          throw new InternalError({
            message: `Job "${jobName}": ctx.defer needs a queued run; it is not available inline (boot gate).`,
          });
        }
        return { kind: "job-deferral", delayMs };
      },
      ...context,
      db: jobDb ?? missingDbProxy(jobName),
      files,
      derivatives,
      ...(notify !== undefined && { notify }),
      ...(config !== undefined && { config }),
      ...(systemDb && { systemDb }),
      ...(crossTenantReads && { crossTenantReads }),
      // The runner owns the registry it resolved this job from — expose it so
      // workers can reach projections/jobs without the app author duplicating
      // it into `context` (the JobContext contract guarantees `registry`).
      registry,
      // Expose the runner so handlers can chain a follow-up job. Symmetric with
      // how the command-dispatcher hands write-handlers their jobRunner.
      ...(selfRunner !== undefined && { jobRunner: selfRunner }),
      systemUser: jobSystemUser,
      triggeredBy: triggeredById !== null ? { id: triggeredById, tenantId } : null,
      attempt,
      finalAttempt,
      log: createJobLogger(logs),
      metricsFor: createMetricsForFactory(context.meter),
      ...(triggerName !== undefined && { triggerName }),
      ...(triggerEvent !== undefined && { triggerEvent }),
      write: (qn: string, payload: unknown) => {
        if (!dispatchWriteRef) {
          throw new Error(
            "JobContext.write called before dispatcher attached — call attachDispatcher() first",
          );
        }
        return dispatchWriteRef.write(jobSystemUser, qn, payload, jobOrigin);
      },
      writeAs: gatedIdentitySwitch.writeAs,
      queryAs: gatedIdentitySwitch.queryAs,
      queryAsMember: (userId: string, qn: string, payload: unknown) => {
        if (!dispatchWriteRef) {
          throw new Error(
            "JobContext.queryAsMember called before dispatcher attached — call attachDispatcher() first",
          );
        }
        // Lazy per-run reader, mirroring the handler-context reader.
        memberReader ??= dispatchWriteRef.createMemberReader(tenantId);
        return memberReader(userId, qn, payload);
      },
    };

    if (tenantVisibleRunDecl && !subjectConfigError) {
      meta.tenantVisibleRun = { tenantId, subject: tenantVisibleRunSubject };
    }
    await options.onJobStart?.(jobName, jobId, meta);

    // Cross-process trace continuation: if the enqueuing code captured a
    // parent span, start the job.execute span as its child. Works for event
    // and manual triggers; cron jobs start a fresh root span.
    const parentContext = readTraceContext(rawData);

    // Correlation propagation: the scheduling request's correlationId was
    // packed into _correlationId at dispatch time. Re-enter requestContext.run
    // so event writes during this job stamp the same correlation as the
    // request that scheduled it. Cron/boot jobs (no scheduler) start fresh
    // — correlationId = new requestId, no parent causation.
    const inheritedCorrelationId = (rawData["_correlationId"] as string | undefined) ?? undefined; // @cast-boundary dynamic-key
    const jobRequestId = requestContext.generateId();
    const jobCorrelationId = inheritedCorrelationId ?? jobRequestId;

    const deferred: { deferral?: JobDeferral } = {};
    const runInSpan = async (): Promise<void> => {
      try {
        if (subjectConfigError) {
          // Retrying cannot fix a declaration error.
          throw new UnrecoverableError(subjectConfigError.message);
        }
        if (writeOriginInvalid) {
          throw new InternalError({
            message:
              `Job "${jobName}" received an unparseable _writeOrigin — refusing to run without ` +
              "a trustworthy anonymous-root gate.",
          });
        }
        const handlerResult = await requestContext.run(
          {
            requestId: jobRequestId,
            correlationId: jobCorrelationId,
            // #3043 — events a job writes carry the job as their origin.
            handler: jobName,
            feature: registry.getJobFeature(jobName) ?? qnScope(jobName),
            writeOrigin: jobOrigin,
            tenantId,
            ...(triggeredById !== null && { userId: triggeredById }),
          },
          async () =>
            jobDef.handler(payload, {
              ...jobContextWithoutTz,
              tz: await resolveJobTz(config, context),
            }),
        );
        if (isJobDeferral(handlerResult)) {
          const maxDefers = jobDef.maxDefers ?? DEFAULT_MAX_DEFERS;
          if (priorDeferCountOf(bullJob.data, HANDLER_DEFER_COUNT_KEY) >= maxDefers) {
            // The counter never resets, so a retry would hit the cap again.
            throw new UnrecoverableError(
              `Job "${jobName}" was deferred ${maxDefers} times (maxDefers); giving up.`,
            );
          }
          deferred.deferral = handlerResult;
          // skip: the deferral is applied after the span closes, below
          return;
        }
        // Stamped before the observer hook: a throwing onJobComplete must not
        // make a run that actually succeeded look dead to the liveness alert.
        if (context.meter) {
          try {
            emitJobLastSuccess(context.meter, jobName);
          } catch (err) {
            errorLogger.warn("job last-success metric failed", {
              job: jobName,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        const duration = Date.now() - startTime;
        await options.onJobComplete?.(jobName, jobId, duration, logs, outcomeMeta(null));
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logs.push({ level: "error", message: errorMsg, timestamp: Temporal.Now.instant() });
        logFailedAttempt({ job: jobName, jobId, attempt, finalAttempt, err });
        await options.onJobFailed?.(
          jobName,
          jobId,
          errorMsg,
          logs,
          outcomeMeta(
            tenantFailureMessageKey(err, tenantVisibleDecl),
            err instanceof UnrecoverableError,
          ),
        );
        throw err;
      }
    };

    // Unified span creation: withSpan handles start/end + status/exception
    // recording identically for both parent-context and no-parent paths.
    // When parentContext is set, the new parent-aware StartSpanOptions
    // plumbs it through to startSpan — no manual try/finally needed.
    try {
      await withEscapeHatchAuditScope(() =>
        tracer.withSpan(
          "job.execute",
          {
            attributes: {
              "job.name": jobName,
              "job.id": jobId,
              "job.attempt": attempt,
              "kumiko.tenant_id": tenantId,
              // Lane-routing attributes (Welle 2.6). `run_in` is the job's
              // declared lane (explicit or default-"worker"); `consumer_lane`
              // is which runner actually executed it. They diverge in
              // all-in-one (both lanes live in one process) but must match
              // in split deploys — a mismatch in prod logs signals a
              // misrouted job that slipped past the boot-validator.
              "kumiko.job.run_in": laneForJob(jobDef),
              // Omit attribute entirely when no consumer (enqueuer-only runner) —
              // SpanAttributeValue doesn't accept undefined.
              ...(consumerLane !== undefined ? { "kumiko.job.consumer_lane": consumerLane } : {}),
            },
            ...(parentContext ? { parent: parentContext } : {}),
          },
          runInSpan,
        ),
      );
      if (deferred.deferral && token !== undefined && bullJob.moveToDelayed) {
        // Run-log bookkeeping must not turn a defer into a failure.
        try {
          await options.onJobDeferred?.(jobName, jobId, meta);
        } catch (err) {
          errorLogger.warn("job deferred hook failed", {
            job: jobName,
            jobId,
            error: scrubLogText(err instanceof Error ? err.message : String(err)),
          });
        }
        await bullJob.updateData?.({
          ...bullJob.data,
          [HANDLER_DEFER_COUNT_KEY]: priorDeferCountOf(bullJob.data, HANDLER_DEFER_COUNT_KEY) + 1,
        });
        await bullJob.moveToDelayed(Date.now() + deferred.deferral.delayMs, token);
        throw new DelayedError();
      }
    } finally {
      // Release the sequential lock value-matched (Lua compare-and-delete
      // inside DistributedLock). A TTL-expired lock that's been claimed by
      // a different owner stays put — releasing it would break sequencing
      // for the new owner.
      if (sequentialToken && sequentialLock) {
        await sequentialLock.release(jobName, sequentialToken);
      }
    }
  }

  // Boot gates run inline and are awaited, so a throwing gate rejects start()
  // — and with it the entrypoint's start() and runProdApp's boot, before the
  // process reports ready. Enqueuing them (as runOnBoot does) would only fail
  // a queue job and let the deploy through (fw#2590).
  async function runBootGates(lane: JobRunIn): Promise<void> {
    for (const [name, jobDef] of allJobs) {
      if (laneForJob(jobDef) !== lane) continue;
      if (!jobDef.bootGate) continue;
      const gateTimeout =
        jobDef.timeout !== undefined
          ? timeoutReject(
              jobDef.timeout,
              `job-runner: boot gate "${name}" did not finish within ${jobDef.timeout}ms`,
            )
          : undefined;
      const slowWarnTimer =
        gateTimeout === undefined
          ? setTimeout(() => {
              errorLogger.warn("boot gate still running, no timeout configured", {
                gate: name,
                afterMs: BOOT_GATE_SLOW_WARN_MS,
              });
            }, BOOT_GATE_SLOW_WARN_MS)
          : undefined;
      const gateRun = handleJob({
        id: bootJobIdForJobName(name),
        name,
        data: {},
        attemptsMade: 0,
        retryable: false,
      });
      const gateSettled = gateRun.then(
        () => undefined,
        () => undefined,
      );
      abandonedBootGates.add(gateSettled);
      void gateSettled.then(() => abandonedBootGates.delete(gateSettled));
      try {
        await Promise.race([gateRun, ...(gateTimeout ? [gateTimeout.promise] : [])]);
      } catch (err) {
        // Leaving the worker's Redis connections open would keep the event loop alive and turn the aborted boot into
        // a hanging process instead of a non-zero exit.
        await worker?.close();
        worker = null;
        throw err;
      } finally {
        gateTimeout?.cancel();
        if (slowWarnTimer !== undefined) clearTimeout(slowWarnTimer);
      }
    }
  }

  function cronSchedulerIdsForLane(lane: JobRunIn): Set<string> {
    const ids = new Set<string>();
    for (const [name, jobDef] of allJobs) {
      if (laneForJob(jobDef) === lane && "cron" in jobDef.trigger) {
        ids.add(schedulerIdForJobName(name));
      }
    }
    return ids;
  }

  async function upsertCronSchedulers(queue: Queue, lane: JobRunIn): Promise<void> {
    for (const [name, jobDef] of allJobs) {
      if (laneForJob(jobDef) !== lane) continue;
      if ("cron" in jobDef.trigger) {
        await queue.upsertJobScheduler(
          schedulerIdForJobName(name),
          cronRepeatOptions(jobDef.trigger),
          {
            name: jobDef.perTenant ? `_perTenant:${name}` : name,
            data: {},
            // Queue-level defaultJobOptions (jobRetentionOpts) covers
            // retention; a count here would sweep queue-wide again and
            // evict perTenant children and boot jobs.
            opts: {
              ...buildRetryBullOpts(jobDef),
            },
          },
        );
      }
    }
  }

  // After a failed initial stamp an older runner may have removed our
  // schedulers as unseen, so the next tick stamps and re-upserts before the
  // flag clears.
  async function refreshSchedulerSeen(
    queue: Queue,
    lane: JobRunIn,
    schedulerIds: ReadonlySet<string>,
  ): Promise<void> {
    await markSchedulersSeen(queue, schedulerIds);
    if (schedulerStampPending) {
      await upsertCronSchedulers(queue, lane);
      schedulerStampPending = false;
    }
  }

  function startSchedulerSeenRefresh(
    queue: Queue,
    lane: JobRunIn,
    schedulerIds: ReadonlySet<string>,
  ): ReturnType<typeof setInterval> | null {
    if (schedulerIds.size === 0) return null;
    const timer = setInterval(() => {
      refreshSchedulerSeen(queue, lane, schedulerIds).catch((err: unknown) => {
        errorLogger.warn("scheduler seen refresh failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, schedulerSeenRefreshMs);
    timer.unref();
    return timer;
  }

  // Bounded: a gate that never returns must not block shutdown as well.
  async function settleAbandonedBootGates(maxWaitMs: number): Promise<void> {
    // skip: no timed-out gate left behind
    if (abandonedBootGates.size === 0) return;
    const wait = timeoutReject(
      maxWaitMs,
      "job-runner: abandoned boot gate still running at stop()",
    );
    try {
      await Promise.race([Promise.all(abandonedBootGates), wait.promise]);
    } catch (err) {
      errorLogger.warn("abandoned boot gate did not finish before stop()", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      wait.cancel();
    }
  }

  const runnerApi: JobRunner = {
    async start(): Promise<void> {
      // skip: enqueuer-only runner — no BullMQ worker, no cron schedules,
      // no boot jobs. The API-process (runLocalJobs=false) lands here; it
      // still holds the queue-clients so dispatch()/handleEvent() can
      // target the worker-lane queue, but nothing local consumes.
      if (!consumerLane) {
        return;
      }

      const consumerQueue = queues[consumerLane];
      worker = new Worker(
        queueNameFor(queueNamePrefix, consumerLane),
        (job, token) => handleJob(job, token),
        {
          connection: redisOpts,
          concurrency: 5,
          // Not consuming until the boot gates passed: a job already queued from a
          // previous run must not execute against an unmet boot precondition.
          autorun: false,
        },
      );
      worker.on("error", (err) => {
        const log = stopping ? errorLogger.debug : errorLogger.error;
        log("worker redis connection error", { error: err.message });
      });
      // A caller that calls stop() right after start() otherwise races the
      // still-settling blocking connection: it rejects in-flight commands
      // via ioredis's flushQueue() during close(), which isn't a listenable
      // 'error' event — the only fix is to not return until both of the
      // worker's connections (main + blocking) are ready (fw#1805). This
      // mirrors the wait BullMQ already does internally for
      // upsertJobScheduler()/add() below when the lane has a cron/boot job.
      // Racing a timeout against it keeps an unreachable Redis from hanging
      // start() forever — there's no worker health endpoint to notice.
      const bootTimeout = timeoutReject(
        bootRedisTimeoutMs,
        `job-runner: Redis not reachable within ${bootRedisTimeoutMs}ms (lane=${consumerLane})`,
      );
      try {
        await Promise.race([worker.waitUntilReady(), bootTimeout.promise]);
      } finally {
        bootTimeout.cancel();
      }

      // Ahead of cron/runOnBoot wiring on purpose: a failed gate must not
      // leave recurring schedulers behind.
      await runBootGates(consumerLane);
      // Floating on purpose: run() resolves only when the worker closes.
      void worker.run().catch((err: unknown) => {
        const log = stopping ? errorLogger.debug : errorLogger.error;
        log("worker run loop failed", { error: err instanceof Error ? err.message : String(err) });
      });

      // Only schedule cron + boot for jobs that belong to this lane. Jobs
      // assigned to the other lane get their cron/boot wiring from the
      // runner running on that lane. Running both here would double-fire.
      const expectedSchedulerIds = cronSchedulerIdsForLane(consumerLane);
      // Before the upserts: a seen entry without a scheduler is harmless, a
      // scheduler a concurrent older runner finds without one gets deleted.
      // Best-effort like the periodic refresh: a failed stamp must not stop the start.
      await markSchedulersSeen(consumerQueue, expectedSchedulerIds).catch((err: unknown) => {
        schedulerStampPending = true;
        errorLogger.warn("scheduler seen stamp failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
      await upsertCronSchedulers(consumerQueue, consumerLane);
      schedulerSeenTimer = startSchedulerSeenRefresh(
        consumerQueue,
        consumerLane,
        expectedSchedulerIds,
      );

      await removeOrphanJobSchedulers(consumerQueue, expectedSchedulerIds, consumerLane, {
        info: (msg, data) =>
          context.log ? context.log.info(msg, data) : errorLogger.debug(msg, data),
        warn: errorLogger.warn,
      });

      // Persistent marker outside the swept completed/failed sets: a plain
      // Redis hash at one key per consumer queue, fields = boot job ids
      // already enqueued (BullMQ's IRedisClient has no set commands, only
      // hash/hexists — a hash with dummy values does the same job). The job
      // hash itself (removeOnComplete/-Fail: age-bound) is not a safe dedup
      // target any more — retention now evicts it eventually, which would
      // otherwise re-run a boot job "once per dataset" every time it ages
      // out. Order matters: HEXISTS check, then add(), then HSET.
      // Concurrent starts still dedupe on the existing job hash from add()'s
      // own jobId no-op; a crash between add() and HSET dedupes again on the
      // *next* boot (the job hash is still there) instead of losing the
      // boot job forever, which HSET-first would risk if the process died
      // before add() ran.
      const bootEnqueuedKey = consumerQueue.toKey("kumiko-boot-enqueued");
      for (const [name, jobDef] of allJobs) {
        if (laneForJob(jobDef) !== consumerLane) continue;
        if (jobDef.runOnBoot) {
          const bootName = jobDef.perTenant ? `_perTenant:${name}` : name;
          const bootJobId = bootJobIdForJobName(name);
          const client = await consumerQueue.client;
          const alreadyEnqueued = await client.hexists(bootEnqueuedKey, bootJobId);
          if (alreadyEnqueued) continue;
          await consumerQueue.add(
            bootName,
            {},
            {
              jobId: bootJobId,
              ...buildRetryBullOpts(jobDef),
            },
          );
          await client.hset(bootEnqueuedKey, { [bootJobId]: 1 });
        }
      }

      // Skipped when no meter is wired (context.meter is optional, e.g. in
      // tests without an observability provider).
      if (context.meter) {
        queueDepthTimer = await startQueueDepthPolling(consumerQueue, consumerLane, context.meter);
      }
    },

    async stop(): Promise<void> {
      stopping = true;
      if (queueDepthTimer) {
        clearInterval(queueDepthTimer);
        queueDepthTimer = null;
      }
      if (schedulerSeenTimer) {
        clearInterval(schedulerSeenTimer);
        schedulerSeenTimer = null;
      }
      if (worker) {
        await worker.close();
        worker = null;
      }
      // BullMQ close() while a Queue's connection is still 'initializing'
      // rejects the in-flight INFO with "Connection is closed." on an emitter
      // without listeners -> unhandled rejection (fw#1805). Wait for readiness
      // first; a failed/timed-out wait must not block the close itself.
      const stopReadyTimeoutMs = Math.min(bootRedisTimeoutMs, STOP_QUEUE_READY_TIMEOUT_MS);
      await settleAbandonedBootGates(stopReadyTimeoutMs);
      const readinessTimeout = timeoutReject(
        stopReadyTimeoutMs,
        `job-runner: Queue not ready within ${stopReadyTimeoutMs}ms during stop()`,
      );
      try {
        await Promise.race([
          Promise.all([queues.api.waitUntilReady(), queues.worker.waitUntilReady()]),
          readinessTimeout.promise,
        ]);
      } catch (err) {
        // close() below still has to run; stopping is already true, so debug matches the other shutdown logs
        errorLogger.debug("queue readiness wait failed during stop()", {
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        readinessTimeout.cancel();
      }
      await Promise.all([queues.api.close(), queues.worker.close()]);
      await flushEscapeHatchAudits();
      if (lockRedis) {
        // quit() drains in-flight commands; disconnect() would cancel them
        // and risk a half-released lock.
        await lockRedis.quit();
        lockRedis = null;
      }
    },

    async dispatch(
      jobName: string,
      payload?: Record<string, unknown>,
      meta?: JobMeta,
    ): Promise<string> {
      const jobDef = allJobs.get(jobName);
      if (!jobDef) {
        throw new Error(`Unknown job: ${jobName}`);
      }

      // Route to the job's declared lane, not the runner's consumer lane —
      // an api-runner is allowed to enqueue a worker-lane job and vice
      // versa (that's the whole point of both queues being held).
      const targetQueue = queues[laneForJob(jobDef)];

      // perTenant: dispatch the fan-out wrapper instead
      if (jobDef.perTenant) {
        const perTenantData: Record<string, unknown> = { ...(payload ?? {}) };
        stampGatedWriteOrigin(perTenantData);
        const job = await targetQueue.add(
          `_perTenant:${jobName}`,
          perTenantData,
          buildRetryBullOpts(jobDef),
        );
        return job.id ?? "unknown";
      }

      // maxPerTenant guard: cap concurrent + waiting jobs of the same name
      // for the same tenant. Orthogonal to the concurrency mode below — runs
      // first because if we're over the limit nothing else matters.
      // Requires a `_tenantId` in the payload to know which bucket to count
      // against; without it the guard is inactive (system jobs, ambient
      // dispatch). Fan-out children of perTenant jobs land here on their
      // recursive queue.add and DO carry _tenantId.
      const maxPerTenant = resolveMaxPerTenant(jobDef);
      if (maxPerTenant?.onLimit === "skip") {
        const tenantId = (payload as { _tenantId?: string } | undefined)?._tenantId; // @cast-boundary dynamic-key
        if (
          tenantId !== undefined &&
          (await isOverPerTenantLimit(jobName, tenantId, maxPerTenant.limit))
        ) {
          return "skipped:max-per-tenant";
        }
      }

      const concurrency = jobDef.concurrency ?? "parallel";
      const bullOpts: Record<string, unknown> = {};

      switch (concurrency) {
        case "skip": {
          const active = await targetQueue.getActive();
          const waiting = await targetQueue.getWaiting();
          const isRunning = [...active, ...waiting].some((j) => j.name === jobName);
          if (isRunning) {
            return "skipped";
          }
          break;
        }
        case "replace": {
          const waiting = await targetQueue.getWaiting();
          for (const j of waiting) {
            if (j.name === jobName && j.id) {
              await j.remove();
              await announceDropped(jobName, jobDef, j.id, j.data);
            }
          }
          break;
        }
        // case "sequential" is rejected at boot — see createJobRunner. Once
        // the OSS-compatible implementation lands (per-name Redis lock),
        // re-add the dispatch branch here.
        case "debounce": {
          const debounceMs = jobDef.debounceMs ?? 5000;
          bullOpts["debounce"] = { id: jobName, ttl: debounceMs };
          break;
        }
        default:
          break;
      }

      Object.assign(bullOpts, buildRetryBullOpts(jobDef));
      if (jobDef.timeout) bullOpts["timeout"] = jobDef.timeout;
      if (meta?.priority !== undefined) bullOpts["priority"] = meta.priority;
      if (meta?.jobId !== undefined) bullOpts["jobId"] = meta.jobId;

      // Pack meta into job data with _ prefix
      const data: Record<string, unknown> = { ...payload };
      if (meta?.triggeredById !== undefined) data["_triggeredById"] = meta.triggeredById;
      if (meta?.payload !== undefined) data["_payload"] = meta.payload;
      // Carry the enqueuing span context into the worker so job.execute shows
      // as a child of the caller.
      const traceCtx = captureTraceContext(tracer);
      if (traceCtx) data[TRACE_CONTEXT_KEY] = traceCtx;
      // Propagate correlation from the scheduling request into the job
      // execution context. The worker re-enters requestContext.run with
      // this value so ctx.appendEvent / executor writes during the job
      // stamp the same correlation as the HTTP request that scheduled it.
      const reqCtx = requestContext.get();
      if (reqCtx?.correlationId) data["_correlationId"] = reqCtx.correlationId;
      stampGatedWriteOrigin(data);

      const job = await targetQueue.add(jobName, data, bullOpts);
      await announceQueued(jobName, jobDef, job.id, data);
      return job.id ?? "unknown";
    },

    async handleEvent(
      eventName: string,
      payload: Record<string, unknown>,
      user?: SessionUser,
      triggerEvent?: JobTriggerEvent,
    ): Promise<void> {
      const traceCtx = captureTraceContext(tracer);
      // Same correlation propagation as dispatch(): events triggered from
      // within a request (or an MSP-apply running under requestContext.run)
      // get their correlationId into job data so the job execution keeps
      // the same causal chain.
      const reqCtx = requestContext.get();
      for (const [name, jobDef] of allJobs) {
        if (!("on" in jobDef.trigger)) continue;
        // skip: andere Trigger-Formen (cron, manual) reagieren nicht auf
        // Events. Nur "on"-Trigger werden hier matched.
        const triggerOn = jobDef.trigger.on;
        const matches = Array.isArray(triggerOn)
          ? triggerOn.includes(eventName)
          : triggerOn === eventName;
        if (!matches) continue;
        if (!payloadMatchesTriggerFilter(jobDef.trigger.where, payload)) continue;
        const data: Record<string, unknown> = { ...payload };
        if (user) {
          data["_tenantId"] = user.tenantId;
          data["_triggeredById"] = user.id;
        }
        // Multi-Trigger: payload bekommt _triggerName damit der Handler
        // weiß, welcher der N Trigger gefeuert hat. Bei Single-Trigger
        // setzen wir es auch — kostet nichts und vereinfacht Handler-Code
        // (kein "ist es Multi?"-Branch nötig).
        data["_triggerName"] = eventName;
        if (triggerEvent) data["_triggerEvent"] = triggerEvent;
        if (traceCtx) data[TRACE_CONTEXT_KEY] = traceCtx;
        if (reqCtx?.correlationId) data["_correlationId"] = reqCtx.correlationId;
        // Same maxPerTenant guard as dispatch — events that fan into many
        // jobs must respect the per-tenant cap or the limit is one-sided.
        const maxPerTenant = resolveMaxPerTenant(jobDef);
        if (maxPerTenant?.onLimit === "skip" && user?.tenantId !== undefined) {
          if (await isOverPerTenantLimit(name, String(user.tenantId), maxPerTenant.limit)) {
            continue;
          }
        }
        stampGatedWriteOrigin(data);
        // Route to the job's declared lane, not a fixed queue — that's
        // the whole reason both queues are held.
        const job = await queues[laneForJob(jobDef)].add(name, data, buildRetryBullOpts(jobDef));
        await announceQueued(name, jobDef, job.id, data);
      }
    },
    attachDispatcher(ref: DispatchWriteRef): void {
      dispatchWriteRef = ref;
    },
    async countPendingJobs(): Promise<number> {
      let total = 0;
      for (const queue of Object.values(queues)) {
        // One getJobCounts call is a single atomic snapshot. Reading delayed in a
        // second call misses a deferred job that cycles delayed -> active between
        // the reads, so delayed is counted here and only repeat schedulers (which
        // stay delayed between cron fires) are subtracted afterwards.
        const counts = await queue.getJobCounts(
          "waiting",
          "active",
          "prioritized",
          "waiting-children",
          "delayed",
        );
        total +=
          (counts["waiting"] ?? 0) +
          (counts["active"] ?? 0) +
          (counts["prioritized"] ?? 0) +
          (counts["waiting-children"] ?? 0) +
          (counts["delayed"] ?? 0);
        // getJobs(["delayed"]) loads full Job objects just to read .id; fine for
        // test-draining's low volume, not a pattern for a prod-path hot loop.
        const delayed = await queue.getJobs(["delayed"]);
        total -= delayed.filter((job) => (job.id ?? "").startsWith("repeat:")).length;
      }
      return total;
    },
  };

  selfRunner = runnerApi;
  return runnerApi;
}

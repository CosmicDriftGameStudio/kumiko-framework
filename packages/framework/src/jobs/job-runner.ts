import type { JobsOptions } from "bullmq";
import { DelayedError, Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { requestContext } from "../api/request-context.ts";
import type { DbConnection } from "../db/connection.ts";
import { createTenantDb, createUncheckedSystemDb } from "../db/tenant-db.ts";
import { bridgeStub } from "../engine/bridge-stub.ts";
import { createSystemUser } from "../engine/system-user.ts";
import type {
  DispatchWriteRef,
  JobRunIn,
  JobTriggerEvent,
  SessionUser,
  TenantId,
} from "../engine/types/index.ts";
import { SYSTEM_TENANT_ID } from "../engine/types/index.ts";
import { InternalError } from "../errors/index.ts";
import { createFallbackLogger } from "../logging/index.ts";
import type { Tracer } from "../observability/index.ts";
import {
  createEscapeHatchProcessDedup,
  createEscapeHatchReporter,
  createEscapeHatchReportWindow,
  flushEscapeHatchAudits,
  getFallbackTracer,
  registerStandardMetrics,
} from "../observability/index.ts";
import type { DistributedLock } from "../pipeline/distributed-lock.ts";
import { createDistributedLock } from "../pipeline/distributed-lock.ts";
import { RedisKeys } from "../pipeline/redis-keys.ts";
import { cronRepeatOptions } from "./cron-repeat-options.ts";
import { applyHandlerDeferral, executeJobInSpan } from "./job-runner-execution.ts";
import {
  claimSequentialSlot,
  deferOverTenantLimit,
  fanOutPerTenantJob,
  PER_TENANT_PREFIX,
  perTenantTargetOf,
  releaseSequentialSlot,
  resolveJobDefinitionOrFail,
  startJobRun,
} from "./job-runner-gates.ts";
import {
  BOOT_GATE_SLOW_WARN_MS,
  BOOT_REDIS_TIMEOUT_MS,
  buildRetryBullOpts,
  COMPLETED_JOB_RETENTION_AGE_SEC,
  captureTraceContext,
  FAILED_JOB_RETENTION_AGE_SEC,
  maxRetryWindowMs,
  parseRedisOpts,
  payloadMatchesTriggerFilter,
  STOP_QUEUE_READY_TIMEOUT_MS,
  stampGatedWriteOrigin,
  startQueueDepthPolling,
  TRACE_CONTEXT_KEY,
  timeoutReject,
} from "./job-runner-helpers.ts";
import {
  ACTIVE_TENANT_IDS_QUERY_NAME,
  bootJobIdForJobName,
  DEFAULT_QUEUE_NAME_PREFIX,
  markSchedulersSeen,
  ORPHAN_SCHEDULER_GRACE_MS,
  queueNameFor,
  removeOrphanJobSchedulers,
  schedulerIdForJobName,
} from "./job-runner-schedulers.ts";
import {
  announceDropped,
  announceQueued,
  isOverPerTenantLimit,
  type JobRunnerScope,
  laneForJob,
} from "./job-runner-scope.ts";
import type { JobInvocation, JobMeta, JobRunner, JobRunnerOptions } from "./job-runner-types.ts";
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
    // bun:test it gets attributed to whichever test happens to run next.
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
  // BullMQ's internal ioredis client.
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

  const scope: JobRunnerScope = {
    registry,
    context,
    options,
    allJobs,
    queues,
    consumerLane,
    tracer,
    errorLogger,
    sequentialLock,
    getActiveTenantIds,
    escapeHatchReportWindow,
    systemCronEscapeHatchDedup,
    getSelfRunner: () => selfRunner,
    getDispatchWriteRef: () => dispatchWriteRef,
  };

  async function handleJob(bullJob: JobInvocation, token?: string): Promise<void> {
    const perTenantTarget = perTenantTargetOf(bullJob.name);
    if (perTenantTarget !== undefined) {
      await fanOutPerTenantJob(scope, bullJob, perTenantTarget);
      // skip: fan-out dispatcher job, per-tenant children enqueued
      return;
    }
    const jobDef = await resolveJobDefinitionOrFail(scope, bullJob);
    if ((await deferOverTenantLimit(scope, jobDef, bullJob, token)) === "deferred") {
      throw new DelayedError();
    }
    const slot = await claimSequentialSlot(scope, jobDef, bullJob);
    if (slot.kind === "requeued") {
      // skip: lock taken, work re-enqueued with delay, current invocation done
      return;
    }
    try {
      const run = await startJobRun(scope, jobDef, bullJob, token);
      const deferral = await executeJobInSpan(scope, run);
      if ((await applyHandlerDeferral(scope, run, bullJob, deferral, token)) === "deferred") {
        throw new DelayedError();
      }
    } finally {
      await releaseSequentialSlot(scope, bullJob.name, slot.lockToken);
    }
  }

  // Boot gates run inline and are awaited, so a throwing gate rejects start()
  // — and with it the entrypoint's start() and runProdApp's boot, before the
  // process reports ready. Enqueuing them (as runOnBoot does) would only fail
  // a queue job and let the deploy through.
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
            name: jobDef.perTenant ? `${PER_TENANT_PREFIX}${name}` : name,
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
      // worker's connections (main + blocking) are ready. This
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
          const bootName = jobDef.perTenant ? `${PER_TENANT_PREFIX}${name}` : name;
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

      // Last on purpose: a start() that fails earlier must not leave a timer stamping for a runner that is not running.
      schedulerSeenTimer = startSchedulerSeenRefresh(
        consumerQueue,
        consumerLane,
        expectedSchedulerIds,
      );
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
      // without listeners -> unhandled rejection. Wait for readiness
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
          `${PER_TENANT_PREFIX}${jobName}`,
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
          (await isOverPerTenantLimit(scope, jobName, tenantId, maxPerTenant.limit))
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
              await announceDropped(scope, jobName, jobDef, j.id, j.data);
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
      await announceQueued(scope, jobName, jobDef, job, data);
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
        // skip: other trigger types (cron, manual) do not respond to events.
        // Only "on" triggers are matched here.
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
        // Multi-trigger: add _triggerName to the payload so the handler knows which
        // of the N triggers fired. Set it for single triggers too; this costs
        // nothing and keeps handler code simple (no "is it multi?" branch).
        data["_triggerName"] = eventName;
        if (triggerEvent) data["_triggerEvent"] = triggerEvent;
        if (traceCtx) data[TRACE_CONTEXT_KEY] = traceCtx;
        if (reqCtx?.correlationId) data["_correlationId"] = reqCtx.correlationId;
        // Same maxPerTenant guard as dispatch — events that fan into many
        // jobs must respect the per-tenant cap or the limit is one-sided.
        const maxPerTenant = resolveMaxPerTenant(jobDef);
        if (maxPerTenant?.onLimit === "skip" && user?.tenantId !== undefined) {
          if (await isOverPerTenantLimit(scope, name, String(user.tenantId), maxPerTenant.limit)) {
            continue;
          }
        }
        stampGatedWriteOrigin(data);
        // Route to the job's declared lane, not a fixed queue — that's
        // the whole reason both queues are held.
        const job = await queues[laneForJob(jobDef)].add(name, data, buildRetryBullOpts(jobDef));
        await announceQueued(scope, name, jobDef, job, data);
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

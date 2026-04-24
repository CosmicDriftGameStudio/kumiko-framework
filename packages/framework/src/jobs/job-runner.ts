import { type Job, Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { requestContext } from "../api/request-context";
import type { DbRow } from "../db/connection";
import { createSystemUser } from "../engine/system-user";
import {
  type AppContext,
  type JobRunIn,
  type Registry,
  type SessionUser,
  SYSTEM_TENANT_ID,
} from "../engine/types";
import type { Logger } from "../logging/types";
import { getFallbackTracer, type SerializedTraceContext, type Tracer } from "../observability";
import { createDistributedLock, type DistributedLock } from "../pipeline/distributed-lock";
import { RedisKeys } from "../pipeline/redis-keys";

// Queue-name convention: <prefix>-<lane>. The prefix is fixed in prod
// ("kumiko-jobs") — it must match between enqueuers and consumers, and an
// accidental drift would silently drop jobs. Tests override via
// `queueNamePrefix` for per-run isolation (stale jobs from a prior run
// don't leak into a new test because the queue name includes a timestamp).
const DEFAULT_QUEUE_NAME_PREFIX = "kumiko-jobs";
function queueNameFor(prefix: string, lane: JobRunIn): string {
  return `${prefix}-${lane}`;
}

export type JobLogEntry = {
  level: "info" | "warn" | "error";
  message: string;
  timestamp: Temporal.Instant;
};

function createJobLogger(logs: JobLogEntry[]): Logger {
  function push(level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) {
    const message = data ? `${msg} ${JSON.stringify(data)}` : msg;
    logs.push({ level, message, timestamp: Temporal.Now.instant() });
  }
  const logger: Logger = {
    info(msg, data) {
      push("info", msg, data);
    },
    warn(msg, data) {
      push("warn", msg, data);
    },
    error(msg, data) {
      push("error", msg, data);
    },
    debug() {},
    child() {
      return logger;
    },
  };
  return logger;
}

export type JobMeta = {
  triggeredById?: string | undefined;
  payload?: string | undefined;
  // BullMQ numbers retries from 1 upward; the logger threads this into
  // the run-started event so audit queries can distinguish "fresh run" vs.
  // "nth retry" without joining back to BullMQ-internals.
  attempt?: number | undefined;
};

export type JobRunner = {
  start(): Promise<void>;
  stop(): Promise<void>;
  dispatch(jobName: string, payload?: Record<string, unknown>, meta?: JobMeta): Promise<string>;
  handleEvent(
    eventName: string,
    payload: Record<string, unknown>,
    user?: SessionUser,
  ): Promise<void>;
};

export type JobRunnerOptions = {
  registry: Registry;
  context: AppContext;
  redisUrl: string;
  // Which lane this runner CONSUMES — i.e. starts a BullMQ worker for and
  // schedules cron/boot jobs on. Undefined = enqueuer-only: the runner
  // still holds queue-clients for BOTH lanes so dispatch()/handleEvent()
  // can enqueue jobs destined for either lane, but no BullMQ worker is
  // started and no cron schedules fire. API processes that don't
  // runLocalJobs leave this unset; worker processes set "worker"; api-
  // processes with runLocalJobs set "api".
  consumerLane?: JobRunIn | undefined;
  // Override the queue-name prefix. Prod uses the default ("kumiko-jobs").
  // Tests set a unique prefix (e.g. `"test-${Date.now()}"`) for isolation —
  // two parallel test-runners never see each other's jobs.
  queueNamePrefix?: string | undefined;
  getActiveTenantIds?: () => Promise<number[]>;
  onJobStart?: (jobName: string, jobId: string, meta: JobMeta) => void;
  onJobComplete?: (jobName: string, jobId: string, duration: number, logs: JobLogEntry[]) => void;
  onJobFailed?: (jobName: string, jobId: string, error: string, logs: JobLogEntry[]) => void;
};

// Serialized trace context lives under this key in the BullMQ job data.
// Leading underscore matches the existing internal-meta convention
// (_triggeredById, _tenantId, _payload).
const TRACE_CONTEXT_KEY = "_traceContext";

function readTraceContext(data: Record<string, unknown>): SerializedTraceContext | undefined {
  const raw = data[TRACE_CONTEXT_KEY];
  if (!raw || typeof raw !== "object") return undefined;
  const ctx = raw as Partial<SerializedTraceContext>;
  if (!ctx.traceId || !ctx.spanId) return undefined;
  return { traceId: ctx.traceId, spanId: ctx.spanId };
}

function captureTraceContext(tracer: Tracer): SerializedTraceContext | undefined {
  const span = tracer.getActiveSpan();
  if (!span?.traceId) return undefined;
  return { traceId: span.traceId, spanId: span.spanId };
}

function parseRedisOpts(url: string): { host: string; port: number; db?: number | undefined } {
  const parsed = new URL(url);
  const result: { host: string; port: number; db?: number | undefined } = {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
  };
  if (parsed.pathname.length > 1) {
    result.db = Number(parsed.pathname.slice(1));
  }
  return result;
}

export function createJobRunner(options: JobRunnerOptions): JobRunner {
  const { registry, context, redisUrl, consumerLane } = options;
  const queueNamePrefix = options.queueNamePrefix ?? DEFAULT_QUEUE_NAME_PREFIX;
  const redisOpts = parseRedisOpts(redisUrl);
  // Use the context's tracer when present (observability-provider injected at
  // boot); otherwise noop so dispatch/handleJob stay zero-cost without config.
  const tracer: Tracer = context.tracer ?? getFallbackTracer();

  const allJobs = registry.getAllJobs();

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
    const lockScope = consumerLane ?? "enqueue";
    sequentialLock = createDistributedLock(lockRedis, `${RedisKeys.lock}seq:${lockScope}:`);
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
  const queues: Readonly<Record<JobRunIn, Queue>> = {
    api: new Queue(queueNameFor(queueNamePrefix, "api"), { connection: redisOpts }),
    worker: new Queue(queueNameFor(queueNamePrefix, "worker"), { connection: redisOpts }),
  };
  let worker: Worker | null = null;

  // Counts active + waiting jobs with this name for this tenant across
  // BOTH lane queues. Jobs with the same name should only live in one
  // lane (jobDef.runIn is static), but walking both is cheap and avoids
  // a subtle bug if someone ever reassigns a job to a different lane
  // between deploys while old queue contents are still draining.
  async function isOverPerTenantLimit(
    jobName: string,
    tenantId: string,
    max: number,
  ): Promise<boolean> {
    const results = await Promise.all([
      queues.api.getActive(),
      queues.api.getWaiting(),
      queues.worker.getActive(),
      queues.worker.getWaiting(),
    ]);
    let count = 0;
    for (const list of results) {
      for (const j of list) {
        if (j.name !== jobName) continue;
        const t = (j.data as { _tenantId?: string } | undefined)?._tenantId;
        if (t === tenantId) {
          count += 1;
          if (count >= max) return true;
        }
      }
    }
    return false;
  }

  async function handleJob(bullJob: Job): Promise<void> {
    const rawName = bullJob.name;

    // Handle perTenant dispatch jobs — fan out to one job per tenant. The
    // fan-out re-enqueues into the lane the actual job is assigned to;
    // the _perTenant wrapper itself always lives in the consumer-lane
    // (it's picked up by this runner's own worker).
    if (rawName.startsWith("_perTenant:")) {
      const actualName = rawName.slice("_perTenant:".length);
      if (!options.getActiveTenantIds) {
        throw new Error(`perTenant job "${actualName}" requires getActiveTenantIds option`);
      }
      const actualDef = allJobs.get(actualName);
      if (!actualDef) {
        throw new Error(`Unknown job: ${actualName}`);
      }
      const tenantIds = await options.getActiveTenantIds();
      const targetQueue = queues[laneForJob(actualDef)];
      for (const tenantId of tenantIds) {
        await targetQueue.add(actualName, { ...bullJob.data, _tenantId: tenantId });
      }
      // skip: fan-out dispatcher job, per-tenant children enqueued
      return;
    }

    const jobName = rawName;
    const jobDef = allJobs.get(jobName);
    if (!jobDef) {
      throw new Error(`Unknown job: ${jobName}`);
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
        await queues[laneForJob(jobDef)].add(jobName, bullJob.data, {
          delay: SEQUENTIAL_RETRY_DELAY_MS,
        });
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
    const meta: JobMeta = {
      triggeredById: rawData["_triggeredById"] as string | undefined,
      payload: rawData["_payload"] as string | undefined,
      attempt: bullJob.attemptsMade + 1,
    };

    // Build handler payload (without internal meta fields)
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawData)) {
      if (!k.startsWith("_")) payload[k] = v;
    }

    // Determine tenantId and triggeredBy from meta
    const tenantId =
      (rawData["_tenantId"] as string | undefined) ??
      (payload["tenantId"] as string | undefined) ??
      SYSTEM_TENANT_ID;
    const triggeredById = (rawData["_triggeredById"] as string | undefined) ?? null;

    const jobContext: AppContext = {
      ...context,
      systemUser: createSystemUser(tenantId),
      triggeredBy: triggeredById !== null ? { id: triggeredById, tenantId } : null,
      log: createJobLogger(logs),
    };

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
    const inheritedCorrelationId = (rawData["_correlationId"] as string | undefined) ?? undefined;
    const jobRequestId = requestContext.generateId();
    const jobCorrelationId = inheritedCorrelationId ?? jobRequestId;

    const runInSpan = async (): Promise<void> => {
      try {
        await requestContext.run({ requestId: jobRequestId, correlationId: jobCorrelationId }, () =>
          jobDef.handler(payload, jobContext),
        );
        const duration = Date.now() - startTime;
        await options.onJobComplete?.(jobName, jobId, duration, logs);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logs.push({ level: "error", message: errorMsg, timestamp: Temporal.Now.instant() });
        await options.onJobFailed?.(jobName, jobId, errorMsg, logs);
        throw err;
      }
    };

    // Unified span creation: withSpan handles start/end + status/exception
    // recording identically for both parent-context and no-parent paths.
    // When parentContext is set, the new parent-aware StartSpanOptions
    // plumbs it through to startSpan — no manual try/finally needed.
    try {
      await tracer.withSpan(
        "job.execute",
        {
          attributes: {
            "job.name": jobName,
            "job.id": jobId,
            "job.attempt": bullJob.attemptsMade + 1,
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
      );
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

  return {
    async start(): Promise<void> {
      // skip: enqueuer-only runner — no BullMQ worker, no cron schedules,
      // no boot jobs. The API-process (runLocalJobs=false) lands here; it
      // still holds the queue-clients so dispatch()/handleEvent() can
      // target the worker-lane queue, but nothing local consumes.
      if (!consumerLane) {
        return;
      }

      const consumerQueue = queues[consumerLane];
      worker = new Worker(queueNameFor(queueNamePrefix, consumerLane), handleJob, {
        connection: redisOpts,
        concurrency: 5,
      });

      // Only schedule cron + boot for jobs that belong to this lane. Jobs
      // assigned to the other lane get their cron/boot wiring from the
      // runner running on that lane. Running both here would double-fire.
      for (const [name, jobDef] of allJobs) {
        if (laneForJob(jobDef) !== consumerLane) continue;
        if ("cron" in jobDef.trigger) {
          await consumerQueue.upsertJobScheduler(
            `scheduler-${name.replace(/\./g, "-")}`,
            { pattern: jobDef.trigger.cron },
            {
              name: jobDef.perTenant ? `_perTenant:${name}` : name,
              data: {},
            },
          );
        }
      }

      for (const [name, jobDef] of allJobs) {
        if (laneForJob(jobDef) !== consumerLane) continue;
        if (jobDef.runOnBoot) {
          const bootName = jobDef.perTenant ? `_perTenant:${name}` : name;
          await consumerQueue.add(bootName, {}, { jobId: `boot-${name.replace(/\./g, "-")}` });
        }
      }
    },

    async stop(): Promise<void> {
      if (worker) {
        await worker.close();
        worker = null;
      }
      await Promise.all([queues.api.close(), queues.worker.close()]);
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
        const job = await targetQueue.add(`_perTenant:${jobName}`, payload ?? {});
        return job.id ?? "unknown";
      }

      // maxPerTenant guard: cap concurrent + waiting jobs of the same name
      // for the same tenant. Orthogonal to the concurrency mode below — runs
      // first because if we're over the limit nothing else matters.
      // Requires a `_tenantId` in the payload to know which bucket to count
      // against; without it the guard is inactive (system jobs, ambient
      // dispatch). Fan-out children of perTenant jobs land here on their
      // recursive queue.add and DO carry _tenantId.
      if (jobDef.maxPerTenant !== undefined) {
        const tenantId = (payload as { _tenantId?: string } | undefined)?._tenantId;
        if (
          tenantId !== undefined &&
          (await isOverPerTenantLimit(jobName, tenantId, jobDef.maxPerTenant))
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

      if (jobDef.retries !== undefined) bullOpts["attempts"] = jobDef.retries + 1;
      if (jobDef.backoff) bullOpts["backoff"] = { type: jobDef.backoff };
      if (jobDef.timeout) bullOpts["timeout"] = jobDef.timeout;

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

      const job = await targetQueue.add(jobName, data, bullOpts);
      return job.id ?? "unknown";
    },

    async handleEvent(
      eventName: string,
      payload: Record<string, unknown>,
      user?: SessionUser,
    ): Promise<void> {
      const traceCtx = captureTraceContext(tracer);
      // Same correlation propagation as dispatch(): events triggered from
      // within a request (or an MSP-apply running under requestContext.run)
      // get their correlationId into job data so the job execution keeps
      // the same causal chain.
      const reqCtx = requestContext.get();
      for (const [name, jobDef] of allJobs) {
        if ("on" in jobDef.trigger && jobDef.trigger.on === eventName) {
          const data: Record<string, unknown> = { ...payload };
          if (user) {
            data["_tenantId"] = user.tenantId;
            data["_triggeredById"] = user.id;
          }
          if (traceCtx) data[TRACE_CONTEXT_KEY] = traceCtx;
          if (reqCtx?.correlationId) data["_correlationId"] = reqCtx.correlationId;
          // Same maxPerTenant guard as dispatch — events that fan into many
          // jobs must respect the per-tenant cap or the limit is one-sided.
          if (jobDef.maxPerTenant !== undefined && user?.tenantId !== undefined) {
            if (await isOverPerTenantLimit(name, String(user.tenantId), jobDef.maxPerTenant)) {
              continue;
            }
          }
          // Route to the job's declared lane, not a fixed queue — that's
          // the whole reason both queues are held.
          await queues[laneForJob(jobDef)].add(name, data);
        }
      }
    },
  };
}

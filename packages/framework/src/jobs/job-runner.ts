import { type Job, Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { requestContext } from "../api/request-context";
import type { DbRow } from "../db/connection";
import { createSystemUser } from "../engine/system-user";
import {
  type AppContext,
  type Registry,
  type SessionUser,
  SYSTEM_TENANT_ID,
} from "../engine/types";
import type { Logger } from "../logging/types";
import { getFallbackTracer, type SerializedTraceContext, type Tracer } from "../observability";
import { createDistributedLock, type DistributedLock } from "../pipeline/distributed-lock";
import { RedisKeys } from "../pipeline/redis-keys";

export type JobLogEntry = {
  level: "info" | "warn" | "error";
  message: string;
  timestamp: Date;
};

function createJobLogger(logs: JobLogEntry[]): Logger {
  function push(level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) {
    const message = data ? `${msg} ${JSON.stringify(data)}` : msg;
    logs.push({ level, message, timestamp: new Date() });
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
  queueName?: string;
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
  const { registry, context, redisUrl } = options;
  const queueName = options.queueName ?? "kumiko-jobs";
  const redisOpts = parseRedisOpts(redisUrl);
  // Use the context's tracer when present (observability-provider injected at
  // boot); otherwise noop so dispatch/handleJob stay zero-cost without config.
  const tracer: Tracer = context.tracer ?? getFallbackTracer();

  const allJobs = registry.getAllJobs();

  // Sequential coordination: BullMQ OSS has no `group`, so we serialise
  // same-name jobs ourselves with a per-name Redis lock. Only built when at
  // least one job actually requested it — keeps the no-sequential boot path
  // free of the extra Redis client.
  const hasSequential = [...allJobs.values()].some((def) => def.concurrency === "sequential");
  let lockRedis: Redis | null = null;
  let sequentialLock: DistributedLock | null = null;
  if (hasSequential) {
    lockRedis = new Redis(redisOpts);
    // Composite under RedisKeys.lock so all framework locks share one prefix
    // tree — discoverable, audit-friendly, namespace-collision-free.
    sequentialLock = createDistributedLock(lockRedis, `${RedisKeys.lock}seq:${queueName}:`);
  }
  // Default lock-TTL for sequential jobs that didn't declare a timeout.
  // 5 minutes matches BullMQ's default stalledInterval — long enough for
  // any reasonable handler, short enough that a crashed worker recovers
  // without manual intervention.
  const SEQUENTIAL_DEFAULT_TTL_SEC = 305;
  // How long to wait before re-trying a busy sequential lock. Short enough
  // to feel responsive, long enough that we don't hammer Redis.
  const SEQUENTIAL_RETRY_DELAY_MS = 200;

  const queue = new Queue(queueName, { connection: redisOpts });
  let worker: Worker | null = null;

  // Counts active + waiting jobs with this name for this tenant. Returns
  // true once the count reaches `max`. Pulls both queues, filters by
  // jobName + payload._tenantId — BullMQ has no built-in label-based
  // counter so we walk the small (active+waiting) set ourselves.
  async function isOverPerTenantLimit(
    jobName: string,
    tenantId: string,
    max: number,
  ): Promise<boolean> {
    const [active, waiting] = await Promise.all([queue.getActive(), queue.getWaiting()]);
    let count = 0;
    for (const j of [...active, ...waiting]) {
      if (j.name !== jobName) continue;
      const t = (j.data as { _tenantId?: string } | undefined)?._tenantId;
      if (t === tenantId) {
        count += 1;
        if (count >= max) return true;
      }
    }
    return false;
  }

  async function handleJob(bullJob: Job): Promise<void> {
    const rawName = bullJob.name;

    // Handle perTenant dispatch jobs — fan out to one job per tenant
    if (rawName.startsWith("_perTenant:")) {
      const actualName = rawName.slice("_perTenant:".length);
      if (!options.getActiveTenantIds) {
        throw new Error(`perTenant job "${actualName}" requires getActiveTenantIds option`);
      }
      const tenantIds = await options.getActiveTenantIds();
      for (const tenantId of tenantIds) {
        await queue.add(actualName, { ...bullJob.data, _tenantId: tenantId });
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
        await queue.add(jobName, bullJob.data, { delay: SEQUENTIAL_RETRY_DELAY_MS });
        // skip: lock taken, work re-enqueued with delay, current invocation done
        return;
      }
    }

    const jobId = bullJob.id ?? "unknown";
    const startTime = Date.now();
    const logs: JobLogEntry[] = [];

    // Extract meta from job data
    const rawData = bullJob.data as DbRow;
    const meta: JobMeta = {
      triggeredById: rawData["_triggeredById"] as string | undefined,
      payload: rawData["_payload"] as string | undefined,
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
        logs.push({ level: "error", message: errorMsg, timestamp: new Date() });
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
      worker = new Worker(queueName, handleJob, {
        connection: redisOpts,
        concurrency: 5,
      });

      // Register scheduled (cron) jobs
      for (const [name, jobDef] of allJobs) {
        if ("cron" in jobDef.trigger) {
          await queue.upsertJobScheduler(
            `scheduler-${name.replace(/\./g, "-")}`,
            { pattern: jobDef.trigger.cron },
            {
              name: jobDef.perTenant ? `_perTenant:${name}` : name,
              data: {},
            },
          );
        }
      }

      // Run boot jobs
      for (const [name, jobDef] of allJobs) {
        if (jobDef.runOnBoot) {
          const bootName = jobDef.perTenant ? `_perTenant:${name}` : name;
          await queue.add(bootName, {}, { jobId: `boot-${name.replace(/\./g, "-")}` });
        }
      }
    },

    async stop(): Promise<void> {
      if (worker) {
        await worker.close();
        worker = null;
      }
      await queue.close();
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

      // perTenant: dispatch the fan-out wrapper instead
      if (jobDef.perTenant) {
        const job = await queue.add(`_perTenant:${jobName}`, payload ?? {});
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
          const active = await queue.getActive();
          const waiting = await queue.getWaiting();
          const isRunning = [...active, ...waiting].some((j) => j.name === jobName);
          if (isRunning) {
            return "skipped";
          }
          break;
        }
        case "replace": {
          const waiting = await queue.getWaiting();
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

      const job = await queue.add(jobName, data, bullOpts);
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
          await queue.add(name, data);
        }
      }
    },
  };
}

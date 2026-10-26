/// <reference types="temporal-polyfill/global" preserve="true" />

import type { ConfigAccessor, JobDefinition } from "@cosmicdrift/kumiko-types/config";
import type { JobDeferral, JobTriggerEvent } from "@cosmicdrift/kumiko-types/handlers";
import type {
  Meter,
  SerializedTraceContext,
  Tracer,
} from "@cosmicdrift/kumiko-types/observability";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import type { TzContext } from "@cosmicdrift/kumiko-types/tz-context";
import type { JobsOptions, Queue } from "bullmq";
import { requestContext } from "../api/request-context.ts";
import type { TenantDb } from "../db/tenant-db.ts";
import type { AppContext, JobRunIn } from "../engine/types/index.ts";
import { SYSTEM_TENANT_ID } from "../engine/types/index.ts";
import { InternalError } from "../errors/index.ts";
import { isKumikoError } from "../errors/kumiko-error.ts";
import { createFallbackLogger, scrubLogText } from "../logging/index.ts";
import type { Logger } from "../logging/types.ts";
import { emitJobQueueDepth } from "../observability/standard-metrics.ts";

import { TENANT_TIMEZONE_CONFIG_KEY } from "../pipeline/tenant-timezone-config-key.ts";
import { isPersonalDataGated } from "../pipeline/write-origin.ts";
import { createTzContext, isValidIanaTimeZone } from "../time/index.ts";
import type { JobInvocation, JobLogEntry, JobSubjectValue } from "./job-runner-types.ts";

// Shape-checked after the BullMQ/Redis JSON round-trip. Unlike `_writeOrigin`
// (a security-relevant escape hatch that must fail the run closed), a
// malformed `_triggerEvent` only costs an idempotency-key convenience — the
// run proceeds without it rather than failing over what would be a framework
// bug, not untrusted input.
export function isJobTriggerEvent(value: unknown): value is JobTriggerEvent {
  if (!isPlainObject(value)) return false;
  if (typeof value["id"] !== "string") return false;
  const headers = value["headers"];
  if (typeof headers !== "object" || headers === null) return false;
  return Object.values(headers).every(
    (v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean",
  );
}

// A payload's own `_writeOrigin` is never trusted; only the ambient gated origin is stamped.
export function stampGatedWriteOrigin(data: Record<string, unknown>): void {
  delete data["_writeOrigin"];
  const origin = requestContext.get()?.writeOrigin;
  if (origin && isPersonalDataGated(origin)) {
    data["_writeOrigin"] = origin;
  }
}

export function createJobLogger(
  logs: JobLogEntry[],
  baseContext: Record<string, unknown> = {},
): Logger {
  function push(level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) {
    const merged = { ...baseContext, ...data };
    const message = Object.keys(merged).length > 0 ? `${msg} ${JSON.stringify(merged)}` : msg;
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
    // No-op by design, not missing coverage: JobLogEntry.level (and the
    // persisted run-completed/-failed event schema in bundled-features/
    // jobs/events.ts) only has info|warn|error — a job's debug() calls have
    // nowhere durable to land.
    debug() {},
    child(context) {
      return createJobLogger(logs, { ...baseContext, ...context });
    },
  };
  return logger;
}

// Single source of the stored subject string: the writer (jobSubjectKey) and
// the tenant failures query both go through it. Matching is exact — field names
// and JSON types must equal what the writer stored (`"1"` is not `1`).
export function serializeJobSubject(subject: Readonly<Record<string, JobSubjectValue>>): string {
  return JSON.stringify(
    Object.keys(subject)
      .sort()
      .map((field) => [field, subject[field] ?? null]),
  );
}

function isJobSubjectValue(value: unknown): value is JobSubjectValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

// Stable identity for the declared payload fields: sorted keys, so two runs
// with the same subject values produce the same string and the later one
// replaces the earlier record. Non-primitives would serialize into something
// no caller can reconstruct for a lookup, so they fail the run loudly.
export function jobSubjectKey(
  jobName: string,
  payload: Record<string, unknown>,
  fields: readonly string[] | undefined,
  declaration: "tenantVisibleFailure" | "tenantVisibleRun",
): string | null {
  if (fields === undefined || fields.length === 0) return null;
  const subject: Record<string, JobSubjectValue> = {};
  for (const field of fields) {
    const value = payload[field] ?? null;
    if (!isJobSubjectValue(value)) {
      throw new Error(
        `Job "${jobName}": ${declaration}.subjectFields["${field}"] must be a primitive, got ${typeof value}`,
      );
    }
    subject[field] = value;
  }
  return serializeJobSubject(subject);
}

// A job that never reads ctx.tz must not fail because the tenant config read did.
async function readTenantTimezoneOrUndefined(
  config: ConfigAccessor | undefined,
  logger: Pick<Logger, "warn">,
): Promise<unknown> {
  if (!config) return undefined;
  try {
    return await config(TENANT_TIMEZONE_CONFIG_KEY);
  } catch (err) {
    logger.warn("tenant timezone config read failed, falling back to UTC", {
      error: scrubLogText(err instanceof Error ? err.message : String(err)),
    });
    return undefined;
  }
}

export async function resolveJobTz(
  config: ConfigAccessor | undefined,
  context: Pick<AppContext, "geoTzProvider" | "clock">,
  logger: Pick<Logger, "warn">,
): Promise<TzContext> {
  const tenantTz = await readTenantTimezoneOrUndefined(config, logger);
  return createTzContext({
    ...(context.geoTzProvider !== undefined && { geoTz: context.geoTzProvider }),
    ...(context.clock !== undefined && { clock: context.clock }),
    tenant: typeof tenantTz === "string" && isValidIanaTimeZone(tenantTz) ? tenantTz : "UTC",
  });
}

// Jobs that never touch ctx.db run fine on a runner built without one; a job
// that does gets a named error instead of a bare TypeError on undefined.
export function missingDbProxy(jobName: string): TenantDb {
  // @cast-boundary db-operator — every access throws, so no TenantDb member is ever returned
  return new Proxy({} as TenantDb, {
    get() {
      throw new InternalError({
        message: `[jobs] job runner constructed without a db connection — ctx.db is unavailable for "${jobName}"`,
      });
    },
  });
}

export function priorAttemptsOf(data: Record<string, unknown>): number {
  const value = data["_priorAttempts"];
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

export function attemptNumberOf(bullJob: JobInvocation): number {
  return bullJob.attemptsMade + 1 + priorAttemptsOf(bullJob.data);
}

// BullMQ stops retrying once attemptsMade reaches the configured attempts
// (`retries + 1`), so this is the attempt whose failure is final.
export function isFinalAttempt(bullJob: JobInvocation, jobDef: JobDefinition): boolean {
  return bullJob.retryable === false || attemptNumberOf(bullJob) >= (jobDef.retries ?? 0) + 1;
}

// Only a translation key ever travels to the tenant: the thrown error's own
// i18nKey when it carries one, otherwise the key declared at the job. The
// error message itself can echo provider or payload content and stays on the
// run row and in the run log.
export function tenantFailureMessageKey(
  err: unknown,
  declaration: JobDefinition["tenantVisibleFailure"],
): string | null {
  // skip: job did not opt in — nothing tenant-visible to record
  if (!declaration) return null;
  if (isKumikoError(err) && err.i18nKey.length > 0) return err.i18nKey;
  return declaration.messageKey;
}

// Serialized trace context lives under this key in the BullMQ job data.
// Leading underscore matches the existing internal-meta convention
// (_triggeredById, _tenantId, _payload).
export const TRACE_CONTEXT_KEY = "_traceContext";

export const DEFER_COUNT_KEY = "_deferCount";

// Separate from the maxPerTenant counter so tenant-limit deferrals do not eat into maxDefers.
export const HANDLER_DEFER_COUNT_KEY = "_handlerDeferCount";

export const DEFAULT_MAX_DEFERS = 100;

export const DEFER_DELAY_CAP_MS = 30_000;

export const DEFER_BACKOFF_MAX_DOUBLINGS = 5;

export function readTraceContext(
  data: Record<string, unknown>,
): SerializedTraceContext | undefined {
  const raw = data[TRACE_CONTEXT_KEY];
  if (!raw || typeof raw !== "object") return undefined;
  const ctx = raw as Partial<SerializedTraceContext>; // @cast-boundary engine-payload
  if (!ctx.traceId || !ctx.spanId) return undefined;
  return { traceId: ctx.traceId, spanId: ctx.spanId };
}

export function captureTraceContext(tracer: Tracer): SerializedTraceContext | undefined {
  const span = tracer.getActiveSpan();
  if (!span?.traceId) return undefined;
  return { traceId: span.traceId, spanId: span.spanId };
}

const QUEUE_DEPTH_POLL_INTERVAL_MS = 15_000;

const QUEUE_DEPTH_WARN_INTERVAL_MS = 5 * 60_000;

// kumiko_job_queue_depth: only the lane's own consumer polls — the count is
// a global Redis-backed value (BullMQ, not per-process), so one reporter per
// lane is enough. Fires once immediately (metrics exist before the first
// poll tick) then on an interval; the caller stores + clears the handle.
export async function startQueueDepthPolling(
  queue: Queue,
  lane: JobRunIn,
  meter: Meter,
): Promise<ReturnType<typeof setInterval>> {
  let lastWarnAt: number | undefined;
  const pollQueueDepth = async (): Promise<void> => {
    try {
      const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed", "paused");
      emitJobQueueDepth(meter, lane, counts);
    } catch (err) {
      // Next poll retries; the warn is throttled so a Redis outage logs once per interval, not once per poll.
      const nowMs = Date.now();
      if (lastWarnAt === undefined || nowMs - lastWarnAt >= QUEUE_DEPTH_WARN_INTERVAL_MS) {
        lastWarnAt = nowMs;
        createFallbackLogger("job-runner").warn("queue depth poll failed", {
          lane,
          error: scrubLogText(err instanceof Error ? err.message : String(err)),
        });
      }
    }
  };
  await pollQueueDepth();
  return setInterval(() => void pollQueueDepth(), QUEUE_DEPTH_POLL_INTERVAL_MS);
}

type RedisConnectionOptions = {
  host: string;
  port: number;
  db?: number | undefined;
  username?: string | undefined;
  password?: string | undefined;
  tls?: Record<string, never> | undefined;
};

export function parseRedisOpts(url: string): RedisConnectionOptions {
  const parsed = new URL(url);
  const result: RedisConnectionOptions = {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
  };
  if (parsed.pathname.length > 1) {
    result.db = Number(parsed.pathname.slice(1));
  }
  if (parsed.username) result.username = decodeURIComponent(parsed.username);
  if (parsed.password) result.password = decodeURIComponent(parsed.password);
  if (parsed.protocol === "rediss:") result.tls = {};
  return result;
}

// redisOpts carries no connectTimeout/retry cap, so an unreachable Redis
// would otherwise hang start() forever with no health endpoint to notice.
export const BOOT_REDIS_TIMEOUT_MS = 10_000;

// Shutdown must fit a k8s grace period even when Redis is down, so the
// readiness wait in stop() is capped well below the boot timeout.
export const STOP_QUEUE_READY_TIMEOUT_MS = 1_000;

// A gate without an explicit `timeout` may legitimately run long (migration-style
// checks), so it is never rejected; a hang just must not stay silent.
export const BOOT_GATE_SLOW_WARN_MS = 60_000;

export function timeoutReject(
  ms: number,
  message: string,
): { promise: Promise<never>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return {
    promise,
    cancel: () => {
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}

// Default base delay when a job opts into backoff without an explicit
// delayMs. Without a `delay`, BullMQ's fixed/exponential strategies compute
// NaN/undefined, which is falsy — the job retries immediately instead of
// waiting.
const DEFAULT_JOB_BACKOFF_DELAY_MS = 1_000;

// Shared by every enqueue path (dispatch(), handleEvent(), cron, runOnBoot,
// perTenant wrapper/children, sequential re-enqueue) — a job with `retries`
// set must retry the same way regardless of how it got enqueued, or it
// fails for good on the very first error on whichever path skips this.
export function buildRetryBullOpts(
  jobDef: JobDefinition,
  priorAttempts = 0,
): Pick<JobsOptions, "attempts" | "backoff"> {
  const opts: Pick<JobsOptions, "attempts" | "backoff"> = {};
  if (jobDef.retries !== undefined) opts.attempts = Math.max(1, jobDef.retries + 1 - priorAttempts);
  if (jobDef.backoff) {
    opts.backoff =
      typeof jobDef.backoff === "string"
        ? { type: jobDef.backoff, delay: DEFAULT_JOB_BACKOFF_DELAY_MS }
        : {
            type: jobDef.backoff.type,
            delay: jobDef.backoff.delayMs ?? DEFAULT_JOB_BACKOFF_DELAY_MS,
          };
  }
  return opts;
}

// Equality filter on top-level payload fields for a job's trigger.where —
// lets N jobs share one broad event QN, partitioned by a payload
// discriminant instead of needing N distinct event types.
export function payloadMatchesTriggerFilter(
  where: Readonly<Record<string, string | number | boolean>> | undefined,
  payload: Record<string, unknown>,
): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => payload[key] === value);
}

type EventJobTrigger = Extract<JobDefinition["trigger"], { readonly on: unknown }>;

export function eventTriggerMatches(
  trigger: EventJobTrigger,
  eventName: string,
  payload: Record<string, unknown>,
): boolean {
  const matches = Array.isArray(trigger.on)
    ? trigger.on.includes(eventName)
    : trigger.on === eventName;
  return matches && payloadMatchesTriggerFilter(trigger.where, payload);
}

// BullMQ rejects ":" in custom ids; job QNs and event ids contain them or dashes.
export function catchUpJobId(jobName: string, eventId: string): string {
  return `catchup.${jobName.replaceAll(":", ".")}.${eventId}`;
}

// BullMQ sweeps queue-wide: any job finishing with keepJobs set can evict
// OTHER jobs in the same completed/failed zset (moveToFinished lua,
// removeJobsByMaxAge/removeJobsByMaxCount), not just the finishing job, and
// the sweep only runs lazily on a later finish into that set. Per-job
// retention is therefore meaningless on a shared queue — only queue-wide,
// age-only retention (no count) is safe: a count would evict perTenant
// children still inside their wrapper's retry window, and boot jobs. The
// completed age must stay above every perTenant wrapper's own worst-case
// retry window (see maxRetryWindowMs and the invariant check in
// createJobRunner below), because child dedup (perTenantChildJobId) relies
// on the children still existing in Redis when a wrapper retry re-derives
// their ids. The margin here is generous — queue wait time isn't bounded by
// backoff — to cover realistic windows. Audit trail lives in read_job_runs,
// not BullMQ.
export const COMPLETED_JOB_RETENTION_AGE_SEC = 86_400; // 24h

export const FAILED_JOB_RETENTION_AGE_SEC = 604_800; // 7d

// Total wall-clock time BullMQ can hold a perTenant wrapper across all its
// retries, consistent with buildRetryBullOpts's own backoff computation.
export function maxRetryWindowMs(jobDef: JobDefinition): number {
  if (!jobDef.backoff || jobDef.retries === undefined) return 0;
  const delayMs =
    (typeof jobDef.backoff === "string" ? undefined : jobDef.backoff.delayMs) ??
    DEFAULT_JOB_BACKOFF_DELAY_MS;
  const type = typeof jobDef.backoff === "string" ? jobDef.backoff : jobDef.backoff.type;
  return type === "exponential" ? delayMs * (2 ** jobDef.retries - 1) : jobDef.retries * delayMs;
}

export function isJobDeferral(value: unknown): value is JobDeferral {
  return (
    typeof value === "object" && value !== null && "kind" in value && value.kind === "job-deferral"
  );
}

export function priorDeferCountOf(data: Record<string, unknown>, key: string): number {
  const prior = data[key];
  return typeof prior === "number" ? prior : 0;
}

export function hasDeferBudgetLeft(
  data: Record<string, unknown>,
  maxDefers: number | undefined,
): boolean {
  return priorDeferCountOf(data, HANDLER_DEFER_COUNT_KEY) < (maxDefers ?? DEFAULT_MAX_DEFERS);
}

export function handlerPayloadOf(data: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!k.startsWith("_")) payload[k] = v;
  }
  return payload;
}

export function tenantIdOfJobData(data: Record<string, unknown>): string {
  return (
    (data["_tenantId"] as string | undefined) ?? // @cast-boundary dynamic-key
    (data["tenantId"] as string | undefined) ?? // @cast-boundary dynamic-key
    SYSTEM_TENANT_ID
  );
}

// Growing delay bounds Redis and worker load while one tenant has a large
// backlog: every deferred job would otherwise be re-checked every deferMs.
export function deferDelayMs(deferMs: number, deferCount: number): number {
  const grown = Math.min(
    deferMs * 2 ** Math.min(deferCount, DEFER_BACKOFF_MAX_DOUBLINGS),
    DEFER_DELAY_CAP_MS,
  );
  return grown + Math.floor(Math.random() * deferMs);
}

export function isActiveBefore(
  other: { readonly id?: string | undefined; readonly processedOn?: number | undefined },
  self: { readonly id: string | undefined; readonly processedOn: number | undefined },
): boolean {
  if (other.id === self.id) return false;
  if (self.processedOn === undefined) return true;
  const otherProcessedOn = other.processedOn ?? 0;
  if (otherProcessedOn !== self.processedOn) return otherProcessedOn < self.processedOn;
  return (other.id ?? "") < (self.id ?? "");
}

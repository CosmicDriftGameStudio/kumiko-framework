/// <reference types="temporal-polyfill/global" preserve="true" />

import type { DispatchWriteRef, JobTriggerEvent } from "@cosmicdrift/kumiko-types/handlers";
import type {
  AppContext,
  JobRunIn,
  Registry,
  SessionUser,
  TenantId,
} from "../engine/types/index.ts";

export type JobLogEntry = {
  level: "info" | "warn" | "error";
  message: string;
  timestamp: Temporal.Instant;
};

export type JobMeta = {
  triggeredById?: string | undefined;
  payload?: string | undefined;
  // BullMQ numbers retries from 1 upward; the logger threads this into
  // the run-started event so audit queries can distinguish "fresh run" vs.
  // "nth retry" without joining back to BullMQ-internals.
  attempt?: number | undefined;
  // BullMQ job priority (lower = processed first). Set per-dispatch so the same
  // job definition can be enqueued at different urgencies (e.g. delivery maps
  // critical/normal/low onto it).
  priority?: number | undefined;
  // BullMQ dedups an add() whose id already exists, so a stable id makes
  // at-least-once enqueuers (event consumers) idempotent.
  jobId?: string | undefined;
  // Set by the runner on onJobStart for jobs with `tenantVisibleRun`.
  tenantVisibleRun?: { readonly tenantId: string; readonly subject: string | null } | undefined;
};

// What the run-logger learns when a tenant-visible job (`tenantVisibleRun`)
// has been enqueued. Subject is resolved exactly as for the run itself.
export type JobQueuedMeta = {
  readonly tenantId: string;
  readonly subject: string | null;
  // BullMQ creation time of the job (epoch ms). A deduplicated add hands back the
  // existing job, so this tells a re-announced job apart from a reused id.
  readonly jobCreatedAtMs: number;
};

// Names the tenant whose queued row a dropped job id belonged to; job ids are
// only unique per queue, so the id alone cannot address the row.
export type JobDroppedMeta = {
  readonly tenantId: string;
};

// What a finished run tells the run-logger about the tenant-visible failure
// record (`JobDefinition.tenantVisibleFailure`). `tenantVisible` is set only
// when the job opted in; `messageKey` is null on the success path, where the
// record is cleared rather than written.
export type JobOutcomeMeta = {
  readonly tenantId: string;
  readonly finalAttempt: boolean;
  readonly tenantVisible?:
    | { readonly subject: string | null; readonly messageKey: string | null }
    | undefined;
  readonly tenantVisibleRun?: { readonly subject: string | null } | undefined;
};

export type JobSubjectValue = string | number | boolean | null;

export type JobRunner = {
  start(): Promise<void>;
  stop(): Promise<void>;
  dispatch(jobName: string, payload?: Record<string, unknown>, meta?: JobMeta): Promise<string>;
  handleEvent(
    eventName: string,
    payload: Record<string, unknown>,
    user?: SessionUser,
    triggerEvent?: JobTriggerEvent,
  ): Promise<void>;
  // Wires JobContext.write/writeAs/queryAs to the real dispatcher — called
  // once at boot, after the dispatcher exists (job-runner construction happens
  // before it). Before this runs, JobContext.write/writeAs/queryAs throw.
  attachDispatcher(ref: DispatchWriteRef): void;
  // Read-only snapshot across both lane queues for test-stack draining
  // (stack.drainJobs()). Excludes delayed jobs whose BullMQ id starts with
  // "repeat:" — those are future cron ticks, not work in flight, and would
  // make drainJobs wait forever on a stack with a scheduled job.
  countPendingJobs(): Promise<number>;
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
  // Override how long start() waits for the worker's Redis connection
  // before failing boot. Defaults to BOOT_REDIS_TIMEOUT_MS; tests shrink it
  // to keep an unreachable-Redis assertion fast.
  bootRedisTimeoutMs?: number | undefined;
  // How often a runner re-stamps its cron schedulers in the orphan-cleanup
  // "seen" hash. Defaults to ORPHAN_SCHEDULER_GRACE_MS / 4; tests shrink it.
  schedulerSeenRefreshMs?: number | undefined;
  // Override how long completed/failed jobs stay in Redis before BullMQ's
  // lazy queue-wide sweep evicts them. Defaults to
  // COMPLETED_JOB_RETENTION_AGE_SEC / FAILED_JOB_RETENTION_AGE_SEC; tests
  // shrink both to exercise the sweep without a real 24h/7d wait.
  jobRetention?:
    | { completedAgeSec?: number | undefined; failedAgeSec?: number | undefined }
    | undefined;
  getActiveTenantIds?: () => Promise<TenantId[]>;
  onJobStart?: (jobName: string, jobId: string, meta: JobMeta) => void;
  onJobComplete?: (
    jobName: string,
    jobId: string,
    duration: number,
    logs: JobLogEntry[],
    outcome?: JobOutcomeMeta,
  ) => void;
  onJobFailed?: (
    jobName: string,
    jobId: string,
    error: string,
    logs: JobLogEntry[],
    outcome?: JobOutcomeMeta,
  ) => void;
  // The handler returned `ctx.defer(ms)`: the run started by onJobStart is void, not a
  // success or failure; the job re-runs later under the same id.
  onJobDeferred?: (jobName: string, jobId: string, meta: JobMeta) => void;
  // After a job with `tenantVisibleRun` was enqueued for a real tenant.
  onJobQueued?: (jobName: string, jobId: string, meta: JobQueuedMeta) => void;
  // A queued job that will never run under that id (concurrency "replace"
  // removal, sequential re-enqueue under a new id).
  onJobDropped?: (jobName: string, jobId: string, meta: JobDroppedMeta) => void;
};

// Structural instead of BullMQ's `Job` so boot gates can invoke the same
// execution path inline. A real `Job` stays assignable, so handleJob is
// still a valid BullMQ Processor.
export type JobInvocation = {
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

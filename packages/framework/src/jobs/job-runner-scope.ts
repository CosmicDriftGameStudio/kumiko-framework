import type { JobType, Queue } from "bullmq";
import { UnrecoverableError } from "bullmq";
import type {
  AppContext,
  DispatchWriteRef,
  JobDefinition,
  JobRunIn,
  Registry,
  TenantId,
} from "../engine/types/index.ts";
import { SYSTEM_TENANT_ID } from "../engine/types/index.ts";
import type { createFallbackLogger } from "../logging/index.ts";
import { scrubLogText } from "../logging/index.ts";
import type {
  EscapeHatchProcessDedup,
  EscapeHatchReportWindow,
  Tracer,
} from "../observability/index.ts";
import type { DistributedLock } from "../pipeline/distributed-lock.ts";
import {
  handlerPayloadOf,
  isActiveBefore,
  jobSubjectKey,
  tenantIdOfJobData,
} from "./job-runner-helpers.ts";
import type { JobRunner, JobRunnerOptions } from "./job-runner-types.ts";

export type JobRunnerScope = {
  readonly registry: Registry;
  readonly context: AppContext;
  readonly options: JobRunnerOptions;
  readonly allJobs: ReadonlyMap<string, JobDefinition>;
  readonly queues: Readonly<Record<JobRunIn, Queue>>;
  readonly consumerLane: JobRunIn | undefined;
  readonly tracer: Tracer;
  readonly errorLogger: ReturnType<typeof createFallbackLogger>;
  readonly sequentialLock: DistributedLock | null;
  // resolved value (options.getActiveTenantIds ?? defaultGetActiveTenantIds()), never options.getActiveTenantIds
  readonly getActiveTenantIds: (() => Promise<TenantId[]>) | undefined;
  readonly escapeHatchReportWindow: EscapeHatchReportWindow;
  readonly systemCronEscapeHatchDedup: EscapeHatchProcessDedup;
  // The runner API and the dispatcher exist only after construction (attachDispatcher), so they are bound late.
  readonly getSelfRunner: () => JobRunner | undefined;
  readonly getDispatchWriteRef: () => DispatchWriteRef | undefined;
};

// Resolve the lane for a job — "worker" is the default because that's the
// sensible prod lane (heavy async off the request path). Jobs that opted
// into "api" must have been validated at registry boot already.
export function laneForJob(def: { readonly runIn?: JobRunIn | undefined }): JobRunIn {
  return def.runIn ?? "worker";
}

// Counts active + waiting jobs with this name for this tenant across
// BOTH lane queues. Jobs with the same name should only live in one
// lane (jobDef.runIn is static), but walking both is cheap and avoids
// a subtle bug if someone ever reassigns a job to a different lane
// between deploys while old queue contents are still draining.
// One getJobs per queue reads the requested lists in a single Lua script, so a job
// moving from waiting to active between two separate reads can no longer vanish
// from the count; that gap let a third dispatch pass the cap in CI.
// `activeOnly` + `self` serve the defer check, which runs inside the job being
// counted: it must not see waiting jobs or itself, and only counts jobs that
// became active before it. Without that order, workers that fetch a burst of
// jobs together all see each other as active and all defer, again and again.
export async function isOverPerTenantLimit(
  scope: JobRunnerScope,
  jobName: string,
  tenantId: string,
  max: number,
  countFilter: {
    readonly activeOnly?: boolean;
    readonly self?: { readonly id: string | undefined; readonly processedOn: number | undefined };
  } = {},
): Promise<boolean> {
  const { queues } = scope;
  const types: JobType[] = countFilter.activeOnly ? ["active"] : ["active", "waiting"];
  const results = await Promise.all([queues.api.getJobs(types), queues.worker.getJobs(types)]);
  let count = 0;
  for (const list of results) {
    for (const j of list) {
      if (j === undefined || j.name !== jobName) continue;
      if (countFilter.self && !isActiveBefore(j, countFilter.self)) continue;
      const t = (j.data as { _tenantId?: string } | undefined)?._tenantId; // @cast-boundary dynamic-key
      if (t === tenantId) {
        count += 1;
        if (count >= max) return true;
      }
    }
  }
  return false;
}

// Tenant-visible queued state. A callback or subject problem must never fail
// the enqueue; a bad subject config surfaces as a failed run instead.
export async function announceQueued(
  scope: JobRunnerScope,
  jobName: string,
  jobDef: JobDefinition,
  queuedJob: { readonly id?: string | undefined; readonly timestamp: number },
  data: Record<string, unknown>,
): Promise<void> {
  const { options } = scope;
  const bullJobId = queuedJob.id;
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
    await options.onJobQueued(jobName, bullJobId, {
      tenantId,
      subject,
      jobCreatedAtMs: queuedJob.timestamp,
    });
  } catch (err) {
    scope.errorLogger.warn("tenant-visible queued state not recorded", {
      job: jobName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function announceDropped(
  scope: JobRunnerScope,
  jobName: string,
  jobDef: JobDefinition,
  bullJobId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const { options } = scope;
  // skip: job did not opt in or no logger wired
  if (!jobDef.tenantVisibleRun || !options.onJobDropped) return;
  const tenantId = tenantIdOfJobData(data);
  // skip: tenant-less run — announceQueued never recorded a row for it
  if (tenantId === SYSTEM_TENANT_ID) return;
  try {
    await options.onJobDropped(jobName, bullJobId, { tenantId });
  } catch (err) {
    scope.errorLogger.warn("tenant-visible queued state not cleared", {
      job: jobName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Only err.message, never payload or the logs array: job payloads can carry PII.
export function logFailedAttempt(
  scope: JobRunnerScope,
  entry: {
    readonly job: string;
    readonly jobId: string;
    readonly attempt: number;
    readonly finalAttempt: boolean;
    readonly err: unknown;
  },
): void {
  scope.errorLogger.error("job failed", {
    job: entry.job,
    jobId: entry.jobId,
    attempt: entry.attempt,
    // BullMQ never retries an UnrecoverableError, whatever attempts remain.
    final: entry.finalAttempt || entry.err instanceof UnrecoverableError,
    error: scrubLogText(entry.err instanceof Error ? entry.err.message : String(entry.err)),
    ...(entry.err instanceof Error && entry.err.stack && { stack: scrubLogText(entry.err.stack) }),
  });
}

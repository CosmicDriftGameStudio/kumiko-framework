/// <reference types="temporal-polyfill/global" preserve="true" />

import type { JobDefinition } from "../engine/types/index.ts";
import { type JobRun, prepareJobRun } from "./job-runner-context.ts";
import {
  attemptNumberOf,
  buildRetryBullOpts,
  DEFER_COUNT_KEY,
  deferDelayMs,
  isFinalAttempt,
  priorAttemptsOf,
  priorDeferCountOf,
} from "./job-runner-helpers.ts";
import { ACTIVE_TENANT_IDS_QUERY_NAME, perTenantChildJobId } from "./job-runner-schedulers.ts";
import {
  announceDropped,
  announceQueued,
  isOverPerTenantLimit,
  type JobRunnerScope,
  laneForJob,
  logFailedAttempt,
} from "./job-runner-scope.ts";
import type { JobInvocation } from "./job-runner-types.ts";
import { resolveMaxPerTenant } from "./max-per-tenant.ts";

// Default lock-TTL for sequential jobs that didn't declare a timeout.
// 5 minutes matches BullMQ's default stalledInterval — long enough for
// any reasonable handler, short enough that a crashed worker recovers
// without manual intervention.
const SEQUENTIAL_DEFAULT_TTL_SEC = 305;
// How long to wait before re-trying a busy sequential lock. Short enough
// to feel responsive, long enough that we don't hammer Redis.
const SEQUENTIAL_RETRY_DELAY_MS = 200;

export const PER_TENANT_PREFIX = "_perTenant:";

export function perTenantTargetOf(jobName: string): string | undefined {
  return jobName.startsWith(PER_TENANT_PREFIX)
    ? jobName.slice(PER_TENANT_PREFIX.length)
    : undefined;
}

function missingTenantResolverError(scope: JobRunnerScope, actualName: string): Error {
  if (scope.registry.getQueryHandler(ACTIVE_TENANT_IDS_QUERY_NAME)) {
    return new Error(
      `perTenant job "${actualName}": the tenant feature is mounted but the job runner has no ` +
        "`context.db`: pass a DbConnection in the runner context or supply options.getActiveTenantIds",
    );
  }
  return new Error(
    `perTenant job "${actualName}" requires either options.getActiveTenantIds or the ` +
      `tenant feature mounted (it registers "${ACTIVE_TENANT_IDS_QUERY_NAME}", which the ` +
      "framework uses to resolve active tenants on its own)",
  );
}

async function enqueuePerTenantChildren(
  scope: JobRunnerScope,
  bullJob: JobInvocation,
  actualName: string,
): Promise<void> {
  const { getActiveTenantIds } = scope;
  if (!getActiveTenantIds) {
    throw missingTenantResolverError(scope, actualName);
  }
  const actualDef = scope.allJobs.get(actualName);
  if (!actualDef) {
    throw new Error(`Unknown job: ${actualName}`);
  }
  const tenantIds = await getActiveTenantIds();
  const targetQueue = scope.queues[laneForJob(actualDef)];
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
      // COMPLETED_JOB_RETENTION_AGE_SEC invariant check in createJobRunner.
      ...(wrapperJobId !== undefined ? { jobId: perTenantChildJobId(wrapperJobId, tenantId) } : {}),
    });
    await announceQueued(scope, actualName, actualDef, child, childData);
  }
}

// Handle perTenant dispatch jobs — fan out to one job per tenant. The
// fan-out re-enqueues into the lane the actual job is assigned to;
// the _perTenant wrapper itself always lives in the consumer-lane
// (it's picked up by this runner's own worker).
export async function fanOutPerTenantJob(
  scope: JobRunnerScope,
  bullJob: JobInvocation,
  actualName: string,
): Promise<void> {
  // These throws happen before runInSpan, so its onJobFailed never sees them
  // and a drained test stack would stay green over a fan-out that never ran.
  try {
    await enqueuePerTenantChildren(scope, bullJob, actualName);
  } catch (err) {
    // A retry may still succeed, and a succeeding wrapper reports no completion
    // that could clear an earlier failure, so only the final attempt is reported.
    const retries = scope.allJobs.get(actualName)?.retries ?? 0;
    const finalAttempt = bullJob.attemptsMade + 1 >= retries + 1;
    logFailedAttempt(scope, {
      job: bullJob.name,
      jobId: bullJob.id ?? "unknown",
      attempt: bullJob.attemptsMade + 1,
      finalAttempt,
      err,
    });
    if (finalAttempt) {
      await reportPreRunFailure(scope, bullJob.name, bullJob, err);
    }
    throw err;
  }
}

async function reportPreRunFailure(
  scope: JobRunnerScope,
  jobName: string,
  bullJob: JobInvocation,
  err: unknown,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await scope.options.onJobFailed?.(jobName, bullJob.id ?? "unknown", message, [
    { level: "error", message, timestamp: Temporal.Now.instant() },
  ]);
}

// prepareJobRun and onJobStart throw before the handler span exists, so the
// span's own failure recording never sees them.
export async function startJobRun(
  scope: JobRunnerScope,
  jobDef: JobDefinition,
  bullJob: JobInvocation,
  token: string | undefined,
): Promise<JobRun> {
  try {
    const run = prepareJobRun(scope, jobDef, bullJob, token);
    await scope.options.onJobStart?.(run.jobName, run.jobId, run.meta);
    return run;
  } catch (err) {
    const finalAttempt = isFinalAttempt(bullJob, jobDef);
    logFailedAttempt(scope, {
      job: bullJob.name,
      jobId: bullJob.id ?? "unknown",
      attempt: attemptNumberOf(bullJob),
      finalAttempt,
      err,
    });
    if (finalAttempt) {
      await reportPreRunFailure(scope, bullJob.name, bullJob, err);
    }
    throw err;
  }
}

export async function resolveJobDefinitionOrFail(
  scope: JobRunnerScope,
  bullJob: JobInvocation,
): Promise<JobDefinition> {
  const jobName = bullJob.name;
  const jobDef = scope.allJobs.get(jobName);
  if (jobDef) return jobDef;
  const err = new Error(`Unknown job: ${jobName}`);
  // Final regardless of attempts left: a retry cannot make the job exist.
  logFailedAttempt(scope, {
    job: jobName,
    jobId: bullJob.id ?? "unknown",
    attempt: bullJob.attemptsMade + 1,
    finalAttempt: true,
    err,
  });
  await reportPreRunFailure(scope, jobName, bullJob, err);
  throw err;
}

// maxPerTenant defer: checked before anything is recorded for this run, so a
// deferred pickup leaves no span, run-log entry or failure trace and does not
// consume an attempt (moveToDelayed + DelayedError, not a retry).
export async function deferOverTenantLimit(
  scope: JobRunnerScope,
  jobDef: JobDefinition,
  bullJob: JobInvocation,
  token: string | undefined,
): Promise<"deferred" | "run"> {
  const maxPerTenant = resolveMaxPerTenant(jobDef);
  const deferTenantId = bullJob.data["_tenantId"];
  if (
    maxPerTenant?.onLimit === "defer" &&
    typeof deferTenantId === "string" &&
    token !== undefined &&
    bullJob.moveToDelayed &&
    (await isOverPerTenantLimit(scope, bullJob.name, deferTenantId, maxPerTenant.limit, {
      activeOnly: true,
      self: { id: bullJob.id, processedOn: bullJob.processedOn },
    }))
  ) {
    const deferCount = priorDeferCountOf(bullJob.data, DEFER_COUNT_KEY);
    await bullJob.updateData?.({ ...bullJob.data, [DEFER_COUNT_KEY]: deferCount + 1 });
    await bullJob.moveToDelayed(Date.now() + deferDelayMs(maxPerTenant.deferMs, deferCount), token);
    return "deferred";
  }
  return "run";
}

export type SequentialSlot =
  | { readonly kind: "run"; readonly lockToken: string | null }
  | { readonly kind: "requeued" };

async function requeueBehindSequentialLock(
  scope: JobRunnerScope,
  jobDef: JobDefinition,
  bullJob: JobInvocation,
): Promise<void> {
  // Re-enqueue onto the job's own lane-queue. In practice that's the
  // same queue the worker just picked from (since only the consuming
  // lane runs handleJob at all), but route explicitly — no implicit
  // coupling to "whichever queue the caller happened to be on".
  // Attempts already spent travel in _priorAttempts so a lock conflict
  // on a retry cannot hand out a fresh budget and exceed `retries`.
  const priorAttempts = priorAttemptsOf(bullJob.data) + bullJob.attemptsMade;
  const requeuedData = { ...bullJob.data, _priorAttempts: priorAttempts };
  const requeued = await scope.queues[laneForJob(jobDef)].add(bullJob.name, requeuedData, {
    delay: SEQUENTIAL_RETRY_DELAY_MS,
    ...buildRetryBullOpts(jobDef, priorAttempts),
  });
  if (bullJob.id !== undefined && bullJob.id !== requeued.id) {
    await announceDropped(scope, bullJob.name, jobDef, bullJob.id, bullJob.data);
  }
  await announceQueued(scope, bullJob.name, jobDef, requeued, requeuedData);
}

// Sequential gate: try to claim the per-name lock. If another worker
// (or this worker on a different bullJob) holds it, re-enqueue with a
// small delay and exit *successfully* — using throw would burn the
// job's retry budget and pollute failure metrics, but a re-enqueue
// looks like an ordinary handoff to BullMQ.
export async function claimSequentialSlot(
  scope: JobRunnerScope,
  jobDef: JobDefinition,
  bullJob: JobInvocation,
): Promise<SequentialSlot> {
  const { sequentialLock } = scope;
  if (jobDef.concurrency !== "sequential" || !sequentialLock) {
    return { kind: "run", lockToken: null };
  }
  const ttlSec = jobDef.timeout ? Math.ceil(jobDef.timeout / 1000) + 5 : SEQUENTIAL_DEFAULT_TTL_SEC;
  const lockToken = await sequentialLock.acquire(bullJob.name, { ttlSeconds: ttlSec });
  if (lockToken) return { kind: "run", lockToken };
  await requeueBehindSequentialLock(scope, jobDef, bullJob);
  return { kind: "requeued" };
}

// Release the sequential lock value-matched (Lua compare-and-delete
// inside DistributedLock). A TTL-expired lock that's been claimed by
// a different owner stays put — releasing it would break sequencing
// for the new owner.
export async function releaseSequentialSlot(
  scope: JobRunnerScope,
  jobName: string,
  lockToken: string | null,
): Promise<void> {
  if (lockToken && scope.sequentialLock) {
    await scope.sequentialLock.release(jobName, lockToken);
  }
}

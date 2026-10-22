/// <reference types="temporal-polyfill/global" preserve="true" />

import { UnrecoverableError } from "bullmq";
import { requestContext } from "../api/request-context.ts";
import { qnScope } from "../engine/qualified-name.ts";
import type { JobDeferral } from "../engine/types/index.ts";
import { InternalError } from "../errors/index.ts";
import { scrubLogText } from "../logging/index.ts";
import { emitJobLastSuccess, withEscapeHatchAuditScope } from "../observability/index.ts";
import type { JobRun } from "./job-runner-context.ts";
import {
  DEFAULT_MAX_DEFERS,
  HANDLER_DEFER_COUNT_KEY,
  isJobDeferral,
  priorDeferCountOf,
  readTraceContext,
  resolveJobTz,
  tenantFailureMessageKey,
} from "./job-runner-helpers.ts";
import { type JobRunnerScope, laneForJob, logFailedAttempt } from "./job-runner-scope.ts";
import type { JobInvocation, JobOutcomeMeta } from "./job-runner-types.ts";

type RunCorrelation = { readonly requestId: string; readonly correlationId: string };

function buildOutcomeMeta(
  run: JobRun,
  messageKey: string | null,
  unrecoverable = false,
): JobOutcomeMeta {
  const { jobDef, subjects } = run;
  return {
    tenantId: run.tenantId,
    // BullMQ never retries an UnrecoverableError, whatever attempts are left.
    finalAttempt: run.finalAttempt || unrecoverable,
    ...(jobDef.tenantVisibleFailure &&
      !subjects.configError && {
        tenantVisible: { subject: subjects.failureSubject, messageKey },
      }),
    ...(jobDef.tenantVisibleRun &&
      !subjects.configError && { tenantVisibleRun: { subject: subjects.runSubject } }),
  };
}

async function runJobHandler(
  scope: JobRunnerScope,
  run: JobRun,
  correlation: RunCorrelation,
): Promise<unknown> {
  if (run.subjects.configError) {
    // Retrying cannot fix a declaration error.
    throw new UnrecoverableError(run.subjects.configError.message);
  }
  if (run.writeOriginInvalid) {
    throw new InternalError({
      message:
        `Job "${run.jobName}" received an unparseable _writeOrigin — refusing to run without ` +
        "a trustworthy anonymous-root gate.",
    });
  }
  return requestContext.run(
    {
      requestId: correlation.requestId,
      correlationId: correlation.correlationId,
      // Events a job writes carry the job as their origin.
      handler: run.jobName,
      feature: scope.registry.getJobFeature(run.jobName) ?? qnScope(run.jobName),
      writeOrigin: run.writeOrigin,
      tenantId: run.tenantId,
      ...(run.triggeredById !== null && { userId: run.triggeredById }),
    },
    async () =>
      run.jobDef.handler(run.payload, {
        ...run.jobContext,
        tz: await resolveJobTz(run.config, scope.context, scope.errorLogger),
      }),
  );
}

function assertDeferBudget(run: JobRun): void {
  const maxDefers = run.jobDef.maxDefers ?? DEFAULT_MAX_DEFERS;
  if (priorDeferCountOf(run.rawData, HANDLER_DEFER_COUNT_KEY) >= maxDefers) {
    // The counter never resets, so a retry would hit the cap again.
    throw new UnrecoverableError(
      `Job "${run.jobName}" was deferred ${maxDefers} times (maxDefers); giving up.`,
    );
  }
}

async function recordJobSuccess(scope: JobRunnerScope, run: JobRun): Promise<void> {
  // Stamped before the observer hook: a throwing onJobComplete must not
  // make a run that actually succeeded look dead to the liveness alert.
  if (scope.context.meter) {
    try {
      emitJobLastSuccess(scope.context.meter, run.jobName);
    } catch (err) {
      scope.errorLogger.warn("job last-success metric failed", {
        job: run.jobName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const duration = Date.now() - run.startTime;
  await scope.options.onJobComplete?.(
    run.jobName,
    run.jobId,
    duration,
    run.logs,
    buildOutcomeMeta(run, null),
  );
}

async function recordJobFailure(scope: JobRunnerScope, run: JobRun, err: unknown): Promise<void> {
  const errorMsg = err instanceof Error ? err.message : String(err);
  run.logs.push({ level: "error", message: errorMsg, timestamp: Temporal.Now.instant() });
  logFailedAttempt(scope, {
    job: run.jobName,
    jobId: run.jobId,
    attempt: run.attempt,
    finalAttempt: run.finalAttempt,
    err,
  });
  await scope.options.onJobFailed?.(
    run.jobName,
    run.jobId,
    errorMsg,
    run.logs,
    buildOutcomeMeta(
      run,
      tenantFailureMessageKey(err, run.jobDef.tenantVisibleFailure),
      err instanceof UnrecoverableError,
    ),
  );
}

async function runAndRecordJob(
  scope: JobRunnerScope,
  run: JobRun,
  correlation: RunCorrelation,
): Promise<JobDeferral | undefined> {
  try {
    const handlerResult = await runJobHandler(scope, run, correlation);
    if (isJobDeferral(handlerResult)) {
      assertDeferBudget(run);
      // skip: the deferral is applied after the span closes
      return handlerResult;
    }
    await recordJobSuccess(scope, run);
    return undefined;
  } catch (err) {
    await recordJobFailure(scope, run, err);
    throw err;
  }
}

export async function executeJobInSpan(
  scope: JobRunnerScope,
  run: JobRun,
): Promise<JobDeferral | undefined> {
  // Cross-process trace continuation: if the enqueuing code captured a
  // parent span, start the job.execute span as its child. Works for event
  // and manual triggers; cron jobs start a fresh root span.
  const parentContext = readTraceContext(run.rawData);

  // Correlation propagation: the scheduling request's correlationId was
  // packed into _correlationId at dispatch time. Re-enter requestContext.run
  // so event writes during this job stamp the same correlation as the
  // request that scheduled it. Cron/boot jobs (no scheduler) start fresh
  // — correlationId = new requestId, no parent causation.
  const inheritedCorrelationId = (run.rawData["_correlationId"] as string | undefined) ?? undefined; // @cast-boundary dynamic-key
  const requestId = requestContext.generateId();
  const correlationId = inheritedCorrelationId ?? requestId;

  // Unified span creation: withSpan handles start/end + status/exception
  // recording identically for both parent-context and no-parent paths.
  // When parentContext is set, the new parent-aware StartSpanOptions
  // plumbs it through to startSpan — no manual try/finally needed.
  return withEscapeHatchAuditScope(() =>
    scope.tracer.withSpan(
      "job.execute",
      {
        attributes: {
          "job.name": run.jobName,
          "job.id": run.jobId,
          "job.attempt": run.attempt,
          "kumiko.tenant_id": run.tenantId,
          // Lane-routing attributes. `run_in` is the job's
          // declared lane (explicit or default-"worker"); `consumer_lane`
          // is which runner actually executed it. They diverge in
          // all-in-one (both lanes live in one process) but must match
          // in split deploys — a mismatch in prod logs signals a
          // misrouted job that slipped past the boot-validator.
          "kumiko.job.run_in": laneForJob(run.jobDef),
          // Omit attribute entirely when no consumer (enqueuer-only runner) —
          // SpanAttributeValue doesn't accept undefined.
          ...(scope.consumerLane !== undefined
            ? { "kumiko.job.consumer_lane": scope.consumerLane }
            : {}),
        },
        ...(parentContext ? { parent: parentContext } : {}),
      },
      () => runAndRecordJob(scope, run, { requestId, correlationId }),
    ),
  );
}

export async function applyHandlerDeferral(
  scope: JobRunnerScope,
  run: JobRun,
  bullJob: JobInvocation,
  deferral: JobDeferral | undefined,
  token: string | undefined,
): Promise<"deferred" | "not-deferred"> {
  if (!deferral || token === undefined || !bullJob.moveToDelayed) return "not-deferred";
  // Run-log bookkeeping must not turn a defer into a failure.
  try {
    await scope.options.onJobDeferred?.(run.jobName, run.jobId, run.meta);
  } catch (err) {
    scope.errorLogger.warn("job deferred hook failed", {
      job: run.jobName,
      jobId: run.jobId,
      error: scrubLogText(err instanceof Error ? err.message : String(err)),
    });
  }
  await bullJob.updateData?.({
    ...bullJob.data,
    [HANDLER_DEFER_COUNT_KEY]: priorDeferCountOf(bullJob.data, HANDLER_DEFER_COUNT_KEY) + 1,
  });
  await bullJob.moveToDelayed(Date.now() + deferral.delayMs, token);
  return "deferred";
}

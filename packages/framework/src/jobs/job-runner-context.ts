/// <reference types="temporal-polyfill/global" preserve="true" />

import type { ConfigAccessor, JobDefinition } from "@cosmicdrift/kumiko-types/config";
import type { WriteOrigin } from "@cosmicdrift/kumiko-types/event-store-types";
import type { JobContext } from "@cosmicdrift/kumiko-types/handlers";
import type { DbRow } from "../db/connection.ts";
import { createSystemUser } from "../engine/system-user.ts";
import type { ContextServices, JobObservability } from "../engine/types/index.ts";
import { createMetricsForFactory } from "../observability/index.ts";
import { buildContextServices } from "../pipeline/context-services.ts";
import { parseWriteOrigin } from "../pipeline/write-origin.ts";
import { createJobAppendEvent } from "./job-append-event.ts";
import {
  buildJobDbFacets,
  buildJobDispatchFacets,
  buildJobServiceFacets,
  createJobDefer,
  createJobEscapeHatchReporter,
  type JobContextInput,
  type JobFacetInput,
} from "./job-runner-facets.ts";
import {
  attemptNumberOf,
  createJobLogger,
  handlerPayloadOf,
  hasDeferBudgetLeft,
  isFinalAttempt,
  isJobTriggerEvent,
  isQueuedRun,
  jobSubjectKey,
  missingDbProxy,
  tenantIdOfJobData,
} from "./job-runner-helpers.ts";
import type { JobRunnerScope } from "./job-runner-scope.ts";
import type { JobInvocation, JobLogEntry, JobMeta } from "./job-runner-types.ts";

export type TenantVisibleSubjects = {
  readonly failureSubject: string | null;
  readonly runSubject: string | null;
  readonly configError: Error | undefined;
};

export type JobRun = {
  readonly jobName: string;
  readonly jobDef: JobDefinition;
  readonly jobId: string;
  readonly startTime: number;
  readonly logs: JobLogEntry[];
  readonly rawData: DbRow;
  readonly attempt: number;
  readonly finalAttempt: boolean;
  readonly meta: JobMeta;
  readonly payload: Record<string, unknown>;
  readonly tenantId: string;
  readonly triggeredById: string | null;
  readonly subjects: TenantVisibleSubjects;
  readonly writeOrigin: WriteOrigin | undefined;
  readonly writeOriginInvalid: boolean;
  readonly config: ConfigAccessor | undefined;
  readonly jobContext: Omit<JobContext, "tz">;
};

// Tenant-visible failure record (JobDefinition.tenantVisibleFailure). The
// subject is read from the handler payload, so it is resolved where the
// payload is built, not in the callbacks.
// A bad subject config must surface as a failed run, so it is only recorded
// here and thrown from inside the span, not before any run record exists.
function resolveTenantVisibleSubjects(
  jobName: string,
  jobDef: JobDefinition,
  payload: Record<string, unknown>,
): TenantVisibleSubjects {
  let failureSubject: string | null = null;
  let runSubject: string | null = null;
  let configError: Error | undefined;
  const runDecl = jobDef.tenantVisibleRun;
  const failureDecl = jobDef.tenantVisibleFailure;
  if (runDecl) {
    try {
      runSubject = jobSubjectKey(jobName, payload, runDecl.subjectFields, "tenantVisibleRun");
    } catch (err) {
      configError = err instanceof Error ? err : new Error(String(err));
    }
  }
  if (failureDecl && !configError) {
    try {
      failureSubject = jobSubjectKey(
        jobName,
        payload,
        failureDecl.subjectFields,
        "tenantVisibleFailure",
      );
    } catch (err) {
      configError = err instanceof Error ? err : new Error(String(err));
    }
  }
  return { failureSubject, runSubject, configError };
}

// Absent = legacy or ungated root; present but invalid fails the run closed.
function parseJobWriteOrigin(
  rawData: DbRow,
  jobName: string,
): { writeOrigin: WriteOrigin | undefined; writeOriginInvalid: boolean } {
  const rawWriteOrigin = rawData["_writeOrigin"]; // @cast-boundary dynamic-key
  if (rawWriteOrigin === undefined) return { writeOrigin: undefined, writeOriginInvalid: false };
  const parsed = parseWriteOrigin(rawWriteOrigin);
  if (!parsed) return { writeOrigin: undefined, writeOriginInvalid: true };
  return { writeOrigin: { ...parsed, viaJob: jobName }, writeOriginInvalid: false };
}

function buildJobServices(
  scope: JobRunnerScope,
  parts: {
    readonly files: ContextServices["files"];
    readonly derivatives: ContextServices["derivatives"];
    readonly selfRunner: ContextServices["jobRunner"];
  },
): ContextServices {
  const { files, derivatives, selfRunner } = parts;
  return buildContextServices(scope.context, {
    ...(files && { files }),
    ...(derivatives && { derivatives }),
    // Expose the runner so handlers can chain a follow-up job. Symmetric with
    // how the command-dispatcher hands write-handlers their jobRunner.
    ...(selfRunner !== undefined && { jobRunner: selfRunner }),
  });
}

function buildJobObservability(
  scope: JobRunnerScope,
  log: JobObservability["log"],
): JobObservability {
  const { meter } = scope.context;
  return {
    log,
    metricsFor: createMetricsForFactory(meter),
    ...(meter && { meter }),
  };
}

function buildJobContext(
  scope: JobRunnerScope,
  input: JobContextInput,
): { jobContext: Omit<JobContext, "tz">; config: ConfigAccessor | undefined } {
  const { jobName, bullJob, token, rawData, tenantId, triggeredById, attempt, finalAttempt } =
    input;
  const systemUser = createSystemUser(tenantId);
  const facetInput: JobFacetInput = {
    input,
    systemUser,
    isSystemJob: scope.registry.isJobSystemScoped(jobName),
    reportEscapeHatch: createJobEscapeHatchReporter(scope, input, systemUser),
  };
  const { tenantScopedDb, jobDb, systemDb, crossTenantReads } = buildJobDbFacets(scope, facetInput);
  const { files, notify, config, derivatives } = buildJobServiceFacets(
    scope,
    facetInput,
    tenantScopedDb,
  );
  const dispatchFacets = buildJobDispatchFacets(scope, facetInput);
  const selfRunner = scope.getSelfRunner();
  // Carry `_triggerName` from rawData when set — handleEvent injects it on
  // multi-trigger dispatch; exposed as jobContext.triggerName so handlers
  // don't dig through the raw payload themselves.
  const triggerName = rawData["_triggerName"] as string | undefined; // @cast-boundary dynamic-key

  // Same carry-through for `_triggerEvent` — handleEvent injects it when
  // the job-trigger event consumer supplied the stored event that fired
  // this run (see createJobTriggerEventConsumer).
  const rawTriggerEvent = rawData["_triggerEvent"];
  const triggerEvent = isJobTriggerEvent(rawTriggerEvent) ? rawTriggerEvent : undefined;
  const jobLogger = createJobLogger(input.logs);
  const jobContext: Omit<JobContext, "tz"> = {
    defer: createJobDefer(jobName, bullJob, token),
    canDefer: isQueuedRun(bullJob, token) && hasDeferBudgetLeft(rawData, input.jobDef.maxDefers),
    db: jobDb ?? missingDbProxy(jobName),
    events: {
      append: createJobAppendEvent({
        registry: scope.registry,
        jobDb,
        tenantId,
        systemUser,
        jobName,
      }),
    },
    services: buildJobServices(scope, { files, derivatives, selfRunner }),
    lifecycle: scope.context.signal ? { signal: scope.context.signal } : {},
    ...(notify !== undefined && { notify }),
    ...(config !== undefined && { config }),
    ...(systemDb && { systemDb }),
    ...(crossTenantReads && { crossTenantReads }),
    // The runner owns the registry it resolved this job from — expose it so
    // workers can reach projections/jobs without the app author duplicating
    // it into `context` (the JobContext contract guarantees `registry`).
    registry: scope.registry,
    systemUser,
    triggeredBy: triggeredById !== null ? { id: triggeredById, tenantId } : null,
    attempt,
    finalAttempt,
    obs: buildJobObservability(scope, jobLogger),
    ...(triggerName !== undefined && { triggerName }),
    ...(triggerEvent !== undefined && { triggerEvent }),
    dispatch: dispatchFacets,
  };
  return { jobContext, config };
}

export function prepareJobRun(
  scope: JobRunnerScope,
  jobDef: JobDefinition,
  bullJob: JobInvocation,
  token: string | undefined,
): JobRun {
  const jobName = bullJob.name;
  const jobId = bullJob.id ?? "unknown";
  const startTime = Date.now();
  const logs: JobLogEntry[] = [];

  // Extract meta from job data. `attempt` is BullMQ's own counter
  // (1-based on the first run, incremented on each retry) — threading
  // it through lets the logger tag the run-started event with the
  // retry number, so audit queries distinguish fresh from retry runs
  // without peeking at BullMQ internals.
  const rawData = bullJob.data;
  const attempt = attemptNumberOf(bullJob);
  // Build handler payload (without internal meta fields)
  const payload = handlerPayloadOf(rawData);
  // Determine tenantId and triggeredBy from meta
  const tenantId = tenantIdOfJobData(rawData);
  const triggeredById = (rawData["_triggeredById"] as string | undefined) ?? null; // @cast-boundary dynamic-key
  const subjects = resolveTenantVisibleSubjects(jobName, jobDef, payload);
  const finalAttempt = isFinalAttempt(bullJob, jobDef);
  const { writeOrigin, writeOriginInvalid } = parseJobWriteOrigin(rawData, jobName);
  const meta: JobMeta = {
    triggeredById: rawData["_triggeredById"] as string | undefined, // @cast-boundary dynamic-key
    payload: rawData["_payload"] as string | undefined, // @cast-boundary dynamic-key
    attempt,
    ...(jobDef.tenantVisibleRun &&
      !subjects.configError && {
        tenantVisibleRun: { tenantId, subject: subjects.runSubject },
      }),
  };
  const { jobContext, config } = buildJobContext(scope, {
    jobName,
    jobDef,
    bullJob,
    token,
    rawData,
    tenantId,
    triggeredById,
    writeOrigin,
    attempt,
    finalAttempt,
    logs,
  });
  return {
    jobName,
    jobDef,
    jobId,
    startTime,
    logs,
    rawData,
    attempt,
    finalAttempt,
    meta,
    payload,
    tenantId,
    triggeredById,
    subjects,
    writeOrigin,
    writeOriginInvalid,
    config,
    jobContext,
  };
}

/// <reference types="temporal-polyfill/global" preserve="true" />

import type { ConfigAccessor } from "@cosmicdrift/kumiko-types/config";
import type { WriteOrigin } from "@cosmicdrift/kumiko-types/event-store-types";
import { crossTenantReadsGrantFor, escapeHatchFor } from "@cosmicdrift/kumiko-types/handlers";
import type { DbConnection, DbRow } from "../db/connection.ts";
import { createCrossTenantReads } from "../db/cross-tenant-reads.ts";
import type { TenantDb } from "../db/tenant-db.ts";
import { createTenantDb, createUncheckedSystemDb } from "../db/tenant-db.ts";
import { createDerivativesContext } from "../derivatives/derivatives-context.ts";
import { createSystemUser } from "../engine/system-user.ts";
import type {
  DispatchWriteRef,
  JobContext,
  JobDefinition,
  MemberReader,
  SessionUser,
} from "../engine/types/index.ts";
import { InternalError } from "../errors/index.ts";
import { createTenantFileContext } from "../files/file-handle.ts";
import { createEscapeHatchReporter, createMetricsForFactory } from "../observability/index.ts";
import { configAccessorFactoryOf } from "../pipeline/config-accessor-factory.ts";
import { createGatedIdentitySwitch } from "../pipeline/system-identity-switch.ts";
import { buildPersonalDataGate, parseWriteOrigin } from "../pipeline/write-origin.ts";
import {
  attemptNumberOf,
  createJobLogger,
  handlerPayloadOf,
  isFinalAttempt,
  isJobTriggerEvent,
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

type JobContextInput = {
  readonly jobName: string;
  readonly jobDef: JobDefinition;
  readonly bullJob: JobInvocation;
  readonly token: string | undefined;
  readonly rawData: DbRow;
  readonly tenantId: string;
  readonly triggeredById: string | null;
  readonly writeOrigin: WriteOrigin | undefined;
  readonly attempt: number;
  readonly finalAttempt: boolean;
  readonly logs: JobLogEntry[];
};

type EscapeHatchReport = ReturnType<typeof createEscapeHatchReporter>;

type JobFacetInput = {
  readonly input: JobContextInput;
  readonly systemUser: SessionUser;
  readonly isSystemJob: boolean;
  readonly reportEscapeHatch: EscapeHatchReport;
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

function createJobEscapeHatchReporter(
  scope: JobRunnerScope,
  input: JobContextInput,
  systemUser: SessionUser,
): EscapeHatchReport {
  const { jobName, jobDef, tenantId, triggeredById } = input;
  // One reporter for ctx.systemDb and ctx.db.unsafeRaw() so both dedupe in the same window.
  const isSystemCronRun =
    triggeredById === null && jobDef.escapeHatch !== undefined && "cron" in jobDef.trigger;
  return createEscapeHatchReporter({
    handler: jobName,
    tenantId,
    actor: systemUser.id,
    sink: scope.context._escapeHatchAuditSink,
    log: scope.errorLogger,
    window: scope.escapeHatchReportWindow,
    ...(triggeredById !== null && { caller: triggeredById }),
    ...(isSystemCronRun && { processDedup: scope.systemCronEscapeHatchDedup }),
    ...(scope.context.meter && { meter: scope.context.meter }),
  });
}

function buildJobDbFacets(
  scope: JobRunnerScope,
  facetInput: JobFacetInput,
): {
  tenantScopedDb: TenantDb | undefined;
  jobDb: TenantDb | undefined;
  systemDb: ReturnType<typeof createUncheckedSystemDb> | undefined;
  crossTenantReads: ReturnType<typeof createCrossTenantReads> | undefined;
} {
  const { context, registry } = scope;
  const { input, isSystemJob, reportEscapeHatch } = facetInput;
  const { jobDef, tenantId, writeOrigin } = input;
  const personalDataGate = writeOrigin ? buildPersonalDataGate(registry, writeOrigin) : undefined;
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
          ...(personalDataGate && { personalDataGate }),
        },
      })
    : undefined;
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
          ...(personalDataGate && { personalDataGate }),
        },
      })
    : undefined;
  const crossTenantReadsReason = crossTenantReadsGrantFor(jobDef.escapeHatch)?.reason;
  const crossTenantReads =
    tenantScopedDb && crossTenantReadsReason !== undefined
      ? createCrossTenantReads(tenantScopedDb, crossTenantReadsReason, reportEscapeHatch)
      : undefined;
  return { tenantScopedDb, jobDb, systemDb, crossTenantReads };
}

function buildJobServiceFacets(
  scope: JobRunnerScope,
  facetInput: JobFacetInput,
  tenantScopedDb: TenantDb | undefined,
): {
  files: JobContext["files"];
  notify: ReturnType<NonNullable<JobRunnerScope["context"]["_notifyFactory"]>> | undefined;
  config: ConfigAccessor | undefined;
  derivatives: JobContext["derivatives"];
} {
  const { context, registry } = scope;
  const { input, systemUser } = facetInput;
  const { tenantId } = input;
  // Mirror dispatch-shared.ts buildHandlerContext: ctx.files must resolve
  // through the same _fileProviderResolver for jobs as for write-handlers,
  // otherwise event-triggered jobs silently get an unresolved ctx.files.
  const fileResolver = context._fileProviderResolver;
  const files = fileResolver ? createTenantFileContext(fileResolver, tenantId) : context.files;
  // Same buildHandlerContext parity as ctx.files above: ctx.notify/ctx.config
  // must resolve for jobs the same way they do for write-handlers, or an
  // app-author job calling ctx.notify(...)/ctx.config(...) hits a TypeError
  // at runtime the write-handler path never would.
  const notify = context._notifyFactory?.(
    systemUser,
    tenantId,
    scope.getSelfRunner(),
    undefined,
    context._fileProviderResolver,
  );
  const configFactory = configAccessorFactoryOf(context);
  const config =
    configFactory && tenantScopedDb
      ? configFactory({
          user: { id: systemUser.id, tenantId },
          db: tenantScopedDb,
          secrets: context.secrets,
        })
      : undefined;
  // Mirror dispatch-shared.ts: ctx.derivatives needs files+db, same
  // tenant-scoped db the config accessor above uses.
  const derivatives =
    files && tenantScopedDb
      ? createDerivativesContext({ files, registry, db: tenantScopedDb, tenantId })
      : context.derivatives;
  return { files, notify, config, derivatives };
}

function requireDispatchRef(scope: JobRunnerScope, method: string): DispatchWriteRef {
  const ref = scope.getDispatchWriteRef();
  if (!ref) {
    throw new Error(
      `JobContext.${method} called before dispatcher attached — call attachDispatcher() first`,
    );
  }
  return ref;
}

function buildJobDispatchFacets(
  scope: JobRunnerScope,
  facetInput: JobFacetInput,
): Pick<JobContext, "write" | "writeAs" | "queryAs" | "queryAsMember"> {
  const { input, systemUser, isSystemJob, reportEscapeHatch } = facetInput;
  const { jobName, jobDef, tenantId, writeOrigin } = input;
  // Per-job-run reader, created lazily on queryAsMember's first call and
  // cached for the rest of this run.
  let memberReader: MemberReader | undefined;
  const identitySwitchHatch = escapeHatchFor(jobDef.escapeHatch, "systemIdentity");
  const identitySwitchGrantReason =
    identitySwitchHatch?.reason ??
    (isSystemJob ? `r.systemScope() feature of job "${jobName}"` : undefined);
  const gatedIdentitySwitch = createGatedIdentitySwitch(
    `job "${jobName}"`,
    systemUser,
    isSystemJob || identitySwitchHatch !== undefined,
    {
      queryAs: (user: SessionUser, qn: string, payload: unknown) =>
        requireDispatchRef(scope, "queryAs").queryAs(user, qn, payload, writeOrigin),
      writeAs: async (user: SessionUser, qn: string, payload: unknown) =>
        requireDispatchRef(scope, "writeAs").write(user, qn, payload, writeOrigin),
    },
    { reason: identitySwitchGrantReason, report: reportEscapeHatch },
  );
  return {
    write: (qn: string, payload: unknown) =>
      requireDispatchRef(scope, "write").write(systemUser, qn, payload, writeOrigin),
    writeAs: gatedIdentitySwitch.writeAs,
    queryAs: gatedIdentitySwitch.queryAs,
    queryAsMember: (userId: string, qn: string, payload: unknown) => {
      const ref = requireDispatchRef(scope, "queryAsMember");
      // Lazy per-run reader, mirroring the handler-context reader.
      memberReader ??= ref.createMemberReader(tenantId);
      return memberReader(userId, qn, payload);
    },
  };
}

function createJobDefer(
  jobName: string,
  bullJob: JobInvocation,
  token: string | undefined,
): JobContext["defer"] {
  return (delayMs) => {
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
  const jobContext: Omit<JobContext, "tz"> = {
    defer: createJobDefer(jobName, bullJob, token),
    ...scope.context,
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
    registry: scope.registry,
    // Expose the runner so handlers can chain a follow-up job. Symmetric with
    // how the command-dispatcher hands write-handlers their jobRunner.
    ...(selfRunner !== undefined && { jobRunner: selfRunner }),
    systemUser,
    triggeredBy: triggeredById !== null ? { id: triggeredById, tenantId } : null,
    attempt,
    finalAttempt,
    log: createJobLogger(input.logs),
    metricsFor: createMetricsForFactory(scope.context.meter),
    ...(triggerName !== undefined && { triggerName }),
    ...(triggerEvent !== undefined && { triggerEvent }),
    ...dispatchFacets,
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

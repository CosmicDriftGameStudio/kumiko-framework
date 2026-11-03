/// <reference types="temporal-polyfill/global" preserve="true" />

import type { ConfigAccessor, JobDefinition } from "@cosmicdrift/kumiko-types/config";
import type { WriteOrigin } from "@cosmicdrift/kumiko-types/event-store-types";
import type {
  DispatchWriteRef,
  JobContext,
  MemberReader,
} from "@cosmicdrift/kumiko-types/handlers";
import { crossTenantReadsGrantFor, escapeHatchFor } from "@cosmicdrift/kumiko-types/handlers";
import type { DbConnection, DbRow } from "../db/connection.ts";
import { createCrossTenantReads } from "../db/cross-tenant-reads.ts";
import type { TenantDb } from "../db/tenant-db.ts";
import { createTenantDb, createUncheckedSystemDb } from "../db/tenant-db.ts";
import { createDerivativesContext } from "../derivatives/derivatives-context.ts";
import type { JobDispatch, SessionUser } from "../engine/types/index.ts";

import { InternalError } from "../errors/index.ts";
import { createTenantFileContext } from "../files/file-handle.ts";
import { createEscapeHatchReporter } from "../observability/escape-hatch-report.ts";
import { configAccessorFactoryOf } from "../pipeline/config-accessor-factory.ts";
import { createGatedIdentitySwitch } from "../pipeline/system-identity-switch.ts";
import { buildPersonalDataGate } from "../pipeline/write-origin.ts";
import { isScheduledTrigger } from "./cron-repeat-options.ts";
import type { JobRunnerScope } from "./job-runner-scope.ts";
import type { JobInvocation, JobLogEntry } from "./job-runner-types.ts";

export type JobContextInput = {
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

export type JobFacetInput = {
  readonly input: JobContextInput;
  readonly systemUser: SessionUser;
  readonly isSystemJob: boolean;
  readonly reportEscapeHatch: EscapeHatchReport;
};

export function createJobEscapeHatchReporter(
  scope: JobRunnerScope,
  input: JobContextInput,
  systemUser: SessionUser,
): EscapeHatchReport {
  const { jobName, jobDef, tenantId, triggeredById } = input;
  // One reporter for ctx.systemDb and ctx.db.unsafeRaw() so both dedupe in the same window.
  const isSystemCronRun =
    triggeredById === null &&
    jobDef.escapeHatch !== undefined &&
    isScheduledTrigger(jobDef.trigger);
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

export function buildJobDbFacets(
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
  // Shared by the config accessor and ctx.services.derivatives below — both need the
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
        reason:
          "job context db for cross-tenant jobs, ctx.systemDb exposure is gated by isSystemJob",
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

export function buildJobServiceFacets(
  scope: JobRunnerScope,
  facetInput: JobFacetInput,
  tenantScopedDb: TenantDb | undefined,
): {
  files: JobContext["services"]["files"];
  notify: ReturnType<NonNullable<JobRunnerScope["context"]["_notifyFactory"]>> | undefined;
  config: ConfigAccessor | undefined;
  derivatives: JobContext["services"]["derivatives"];
} {
  const { context, registry } = scope;
  const { input, systemUser } = facetInput;
  const { tenantId } = input;
  // Mirror dispatch-shared.ts buildHandlerContext: ctx.services.files must resolve
  // through the same _fileProviderResolver for jobs as for write-handlers,
  // otherwise event-triggered jobs silently get an unresolved ctx.services.files.
  const fileResolver = context._fileProviderResolver;
  const files = fileResolver ? createTenantFileContext(fileResolver, tenantId) : context.files;
  // Same buildHandlerContext parity as ctx.services.files above: ctx.notify/ctx.config
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
  // Mirror dispatch-shared.ts: ctx.services.derivatives needs files+db, same
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

export function buildJobDispatchFacets(
  scope: JobRunnerScope,
  facetInput: JobFacetInput,
): JobDispatch {
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

export function createJobDefer(
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

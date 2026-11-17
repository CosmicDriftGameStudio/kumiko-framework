import {
  createSystemUser,
  type FeatureRegistrar,
  type JobHandlerFn,
  SYSTEM_USER_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createNoopMetricsHandle,
  createSafeMetricsHandle,
} from "@cosmicdrift/kumiko-framework/observability";
import { createConfigAccessor } from "../config/index.ts";
import { makeTenantStorageProviderResolver } from "../file-foundation/index.ts";
import { makeTenantMailTransportResolver } from "../mail-foundation/index.ts";
import {
  isGdprMailDeliveryAvailable,
  isMailRendererAvailable,
  isMailTransportAvailable,
  makeDefaultDeletionExecutedEmail,
  makeDefaultExportFailedEmail,
  makeDefaultExportReadyEmail,
} from "./lib/default-mailers.ts";
import { resolveAppTenantModel } from "./lib/resolve-tenant-model.ts";
import type { UserDataRightsOptions } from "./options.ts";
import {
  EXPORT_CLEANUP_BACKLOG_AGE_METRIC,
  EXPORT_CLEANUP_LAST_RUN_TIMESTAMP_METRIC,
  runExportJobs,
} from "./run-export-jobs.ts";
import {
  FORGET_CLEANUP_HANDLER_NAME,
  runForgetCleanup,
  sanitizeReasonForLog,
} from "./run-forget-cleanup.ts";

const RUN_EXPORT_JOBS_REASON = "processes pending export jobs across every tenant";
const RUN_FORGET_CLEANUP_REASON = "executes overdue Art.17 forget requests across every tenant";

export type ExportJobWarnings = { missingExportUrl: boolean };

export function registerUserDataRightsJobs(
  r: FeatureRegistrar<"user-data-rights">,
  opts: UserDataRightsOptions,
  exportWarnings: ExportJobWarnings,
): void {
  // Gauges keep their last value, so a dead cleanup cron does not clear the backlog gauge;
  // the last-run timestamp gauge is the liveness signal.
  r.metric({ name: EXPORT_CLEANUP_BACKLOG_AGE_METRIC, type: "gauge",
    unit: "seconds",
    description:
      "Age in seconds of the oldest export bundle (done: expiresAt+grace passed; failed: orphaned ZIP since completedAt or startedAt) whose downloadStorageKey is still set. 0 when the storage-cleanup pass has no backlog." });
  r.metric({ name: EXPORT_CLEANUP_LAST_RUN_TIMESTAMP_METRIC, type: "gauge",
    unit: "seconds",
    description:
      "Unix timestamp of the last export storage-cleanup pass that completed. Alert on time() minus this value exceeding one day plus a buffer; the backlog-age gauge alone stays at its last value when the cron stops." });

  const runExport: JobHandlerFn = async (_payload, ctx) => {
    if (!ctx.registry) {
      throw new Error("run-export-jobs: ctx.registry required (JobContext incomplete)");
    }
    const exportUserId = SYSTEM_USER_ID;
    const exportDb = ctx.db.unsafeRawAllTenants();
    const exportRegistry = ctx.registry;
    // JobContext has the raw meter only; the safe handle is a no-op when metrics are off.
    const exportMetrics = ctx.obs.meter
      ? createSafeMetricsHandle(ctx.obs.meter, "user-data-rights")
      : createNoopMetricsHandle();

    // Without explicit send*Email options the default templates go out through delivery;
    // the run spans tenants, so each mail needs a notify bound to the recipient's tenant.
    const notifyFactory = ctx.services._notifyFactory;
    const exportNotifyFor =
      notifyFactory !== undefined && isGdprMailDeliveryAvailable(exportRegistry)
        ? (tenantId: TenantId) => notifyFactory(createSystemUser(tenantId), tenantId)
        : undefined;
    const sendExportReadyEmail =
      opts.sendExportReadyEmail ??
      (exportNotifyFor && opts.appExportDownloadUrl !== undefined
        ? makeDefaultExportReadyEmail(exportNotifyFor, opts.mailDefaults)
        : undefined);
    const sendExportFailedEmail =
      opts.sendExportFailedEmail ??
      (exportNotifyFor
        ? makeDefaultExportFailedEmail(exportNotifyFor, opts.mailDefaults)
        : undefined);
    if (
      exportNotifyFor &&
      !opts.sendExportReadyEmail &&
      opts.appExportDownloadUrl === undefined &&
      !exportWarnings.missingExportUrl
    ) {
      exportWarnings.missingExportUrl = true;
      // biome-ignore lint/suspicious/noConsole: one-shot operator visibility for misconfig
      console.warn(
        "[user-data-rights:run-export-jobs] mail delivery mounted but appExportDownloadUrl unset — default export-ready emails disabled (export-failed + deletion mails still send)",
      );
    }

    await runExportJobs({
      db: exportDb,
      registry: exportRegistry,
      // The job context carries configResolver, not a per-request ConfigAccessor; the resolver builds
      // a per-tenant one, otherwise createFileProviderForTenant throws and every export fails.
      buildStorageProvider: makeTenantStorageProviderResolver({
        registry: exportRegistry,
        configResolver: ctx.services.configResolver,
        secrets: ctx.services.secrets,
        db: exportDb,
        userId: exportUserId,
        handlerName: "user-data-rights:run-export-jobs",
      }),
      now: ctx.tz.now(),
      // Both optional: without a callback or mail transport, clients poll export-status.query.
      ...(sendExportReadyEmail && { sendExportReadyEmail }),
      ...(sendExportFailedEmail && { sendExportFailedEmail }),
      ...(opts.appExportDownloadUrl !== undefined && {
        appExportDownloadUrl: opts.appExportDownloadUrl,
      }),
      escapeHatchAuditSink: ctx.services._escapeHatchAuditSink,
      escapeHatchAuditLog: ctx.obs.log,
      actor: ctx.systemUser.id,
      metrics: exportMetrics,
    });
  };

  r.job({
    name: "run-export-jobs",
    trigger: { maintenance: true },
    concurrency: "skip",
    escapeHatch: { reason: RUN_EXPORT_JOBS_REASON, grants: ["unsafeRaw"] },
    handler: runExport,
  });

  // "replace", not "skip": a request arriving during a pass must still get its own run; claims are version-locked.
  // An isExisting click creates no event; the pass that is already running picks that row up.
  r.job({
    name: "run-requested-export",
    trigger: { on: "export-job.created" },
    concurrency: "replace",
    escapeHatch: { reason: RUN_EXPORT_JOBS_REASON, grants: ["unsafeRaw"] },
    handler: runExport,
  });

  // Without this job, deletion requests stay in DeletionRequested forever and Art. 17 erasure never runs;
  // the manual userDataRights.runForget API remains for operator runs.
  r.job({
    name: "run-forget-cleanup",
    trigger: { maintenance: true },
    irreversibleWithoutEntryHandler: "high-risk-or-cron-pipeline",
    concurrency: "skip",
    escapeHatch: { reason: RUN_FORGET_CLEANUP_REASON, grants: ["unsafeRaw"] },
    handler: async (_payload, ctx) => {
      if (!ctx.registry) {
        throw new Error("run-forget-cleanup: ctx.registry required (JobContext incomplete)");
      }
      const forgetUserId = SYSTEM_USER_ID;
      const forgetDb = ctx.db.unsafeRawAllTenants();
      const forgetRegistry = ctx.registry;
      const tenantModel = await resolveAppTenantModel({
        registry: forgetRegistry,
        configResolver: ctx.services.configResolver,
        db: forgetDb,
        userId: forgetUserId,
      });

      // Without an app callback the default mail goes out when an email channel or a
      // mail transport, plus a mail renderer, are mounted. The user is already erased
      // here, so it bypasses the delivery log: an attempt row would be new personal data.
      const forgetConfigResolver = ctx.services.configResolver;
      const sendDeletionExecutedEmail =
        opts.sendDeletionExecutedEmail ??
        ((isGdprMailDeliveryAvailable(forgetRegistry) ||
          isMailTransportAvailable(forgetRegistry)) &&
        isMailRendererAvailable(forgetRegistry)
          ? makeDefaultDeletionExecutedEmail(
              {
                registry: forgetRegistry,
                db: forgetDb,
                ...(ctx.services.secrets !== undefined && { secrets: ctx.services.secrets }),
                resolveTransport: makeTenantMailTransportResolver({
                  registry: forgetRegistry,
                  configResolver: forgetConfigResolver,
                  secrets: ctx.services.secrets,
                  db: forgetDb,
                  userId: forgetUserId,
                  handlerName: FORGET_CLEANUP_HANDLER_NAME,
                }),
                configFor: (tenantId) =>
                  forgetConfigResolver &&
                  createConfigAccessor(
                    forgetRegistry,
                    forgetConfigResolver,
                    tenantId,
                    forgetUserId,
                    forgetDb,
                  ),
              },
              opts.mailDefaults,
            )
          : undefined);

      const forgetResult = await runForgetCleanup({
        db: forgetDb,
        registry: forgetRegistry,
        now: ctx.tz.now(),
        tenantModel,
        ...(ctx.services.searchAdapter !== undefined && {
          searchAdapter: ctx.services.searchAdapter,
        }),
        // Forget deletes binaries from the store, so it resolves the per-tenant provider like the export.
        buildStorageProvider: makeTenantStorageProviderResolver({
          registry: forgetRegistry,
          configResolver: ctx.services.configResolver,
          secrets: ctx.services.secrets,
          db: forgetDb,
          userId: forgetUserId,
          handlerName: FORGET_CLEANUP_HANDLER_NAME,
        }),
        ...(sendDeletionExecutedEmail && { sendDeletionExecutedEmail }),
        escapeHatchAuditSink: ctx.services._escapeHatchAuditSink,
        escapeHatchAuditLog: ctx.obs.log,
        actor: ctx.systemUser.id,
      });

      // ctx.obs.log feeds createJobRunLogger → store_job_run_logs.
      for (const entry of forgetResult.incomplete) {
        ctx.obs.log?.warn?.(
          `[user-data-rights:run-forget-cleanup] incomplete hook ` +
            `userId=${entry.userId} tenantId=${entry.tenantId} ` +
            `entityName=${entry.entityName} rolledBack=${entry.rolledBack} ` +
            `reason=${sanitizeReasonForLog(entry.reason)}`,
        );
      }
    },
  });
}

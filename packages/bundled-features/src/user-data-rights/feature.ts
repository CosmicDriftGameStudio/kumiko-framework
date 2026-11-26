import {
  createSystemConfig,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import {
  validateGdprHookCompleteness,
  validateGdprMailAppName,
  validateGdprPiiHookCoverage,
} from "./boot-checks.ts";
import { deletionTokenSecretEnvSchema } from "./env.ts";
import { registerExportDownloadRoutes } from "./export-download-routes.ts";
import { cancelDeletionWrite } from "./handlers/cancel-deletion.write.ts";
import { createCancelDeletionByTokenHandler } from "./handlers/cancel-deletion-by-token.write.ts";
import { createConfirmDeletionByTokenHandler } from "./handlers/confirm-deletion-by-token.write.ts";
import { downloadAttemptListQuery } from "./handlers/download-attempt-list.query.ts";
import { downloadByJobQuery } from "./handlers/download-by-job.query.ts";
import { downloadByTokenQuery } from "./handlers/download-by-token.query.ts";
import { exportJobDetailQuery } from "./handlers/export-job-detail.query.ts";
import { exportJobListQuery } from "./handlers/export-job-list.query.ts";
import { exportStatusQuery } from "./handlers/export-status.query.ts";
import { liftRestrictionWrite } from "./handlers/lift-restriction.write.ts";
import { listDownloadAttemptsQuery } from "./handlers/list-download-attempts.query.ts";
import { myAuditLogQuery } from "./handlers/my-audit-log.query.ts";
import { createRequestDeletionHandler } from "./handlers/request-deletion.write.ts";
import { createRequestDeletionByEmailHandler } from "./handlers/request-deletion-by-email.write.ts";
import { requestExportWrite } from "./handlers/request-export.write.ts";
import { restrictAccountWrite } from "./handlers/restrict-account.write.ts";
import { createRunForgetCleanupHandler } from "./handlers/run-forget-cleanup.write.ts";
import { USER_DATA_RIGHTS_HANDLER_I18N } from "./i18n.ts";
import { type ExportJobWarnings, registerUserDataRightsJobs } from "./jobs.ts";
import { registerGdprMails } from "./mail-notifications.ts";
import type { UserDataRightsOptions } from "./options.ts";
import { downloadAttemptEntity } from "./schema/download-attempt.ts";
import { exportDownloadTokenEntity } from "./schema/download-token.ts";
import { exportJobEntity } from "./schema/export-job.ts";
import {
  downloadAttemptListScreen,
  exportJobDetailScreen,
  exportJobListScreen,
  PRIVACY_CENTER_TRANSLATIONS,
  privacyCenterScreen,
} from "./screens.ts";
import { UserDataRightsScreens } from "./web/constants.ts";
import { USER_DATA_RIGHTS_I18N } from "./web/i18n.ts";

// user-data-rights — GDPR Articles 15 (access), 17 (erasure),
// 18 (restriction), and 20 (portability) as a core feature.
//
// Instead of making each feature implement its own forget/export logic,
// it registers through `r.applyExtension({ name: EXT_USER_DATA, entity: "<entity>", // export, delete })`. user-data-rights orchestrates:
//   - Export job: iterates over all extension registrations and collects JSON
//   - Forget job: iterates over all registrations and calls each delete hook
//     with the strategy from `retention.policyFor` (data-retention)
//   - Restriction: flips the user-schema status and enables the auth guard

function isMailTransportMountedWithoutDelivery(features: readonly FeatureDefinition[]): boolean {
  const names = new Set(features.map((feature) => feature.name));
  const hasTransport = [...names].some((name) => name.startsWith("mail-transport-"));
  return (
    names.has("mail-foundation") &&
    hasTransport &&
    !(names.has("delivery") && names.has("channel-email"))
  );
}

export function createUserDataRightsFeature(opts: UserDataRightsOptions = {}): FeatureDefinition {
  // Warn once per process, not per daily run; the job closures share this state.
  const exportWarnings: ExportJobWarnings = { missingExportUrl: false };
  let warnedMissingMailDelivery = false;
  const showDeletion = opts.privacyCenterShowDeletion ?? true;
  return defineFeature("user-data-rights", (r) => {
    r.describe(
      'Implements GDPR Art. 15 (access / `my-audit-log` query), Art. 17 (erasure / `request-deletion` + `cancel-deletion`, plus the anonymous email-verified `request-deletion-by-email` + `confirm-deletion-by-token` flow for lockout-safe self-service, + cron cleanup with grace period), Art. 18 (restriction / `restrict-account` + `lift-restriction`), and Art. 20 (portability / async `request-export` \u2192 ZIP via `file-foundation`, Magic-Link download) as first-class HTTP handlers and cron jobs. Each domain feature opts in by calling `r.applyExtension({ name: EXT_USER_DATA, entity: "<entity>", export, delete })` \u2014 the feature then orchestrates the export and forget pipelines across all registered hooks automatically. When `mail-foundation` and a `mail-transport-*` are mounted, it also sends the GDPR notifications (export ready/failed, deletion requested/executed) itself with no app callback code, rendered in each recipient’s locale. The anonymous deletion flow sends its verify mail itself through delivery. Requires `user`, `data-retention`, `compliance-profiles`, and `sessions`.',
    );
    r.uiHints({
      displayLabel: "User Data Rights \u00b7 GDPR",
      category: "compliance",
      recommended: false,
    });
    r.requires({ features: ["user", "data-retention", "compliance-profiles", "sessions"] });
    // The anonymous deletion verify mail goes through ctx.notify.
    if (opts.deletionTokenSecret !== undefined && opts.deletionVerifyUrl !== undefined) {
      r.requires({ features: ["delivery", "channel-email"] });
    }
    r.envSchema(deletionTokenSecretEnvSchema);
    r.usesApi("compliance.forTenant");
    r.usesApi("retention.policyFor");
    // restrict-account calls sessions.revokeAllForUser across features.
    // r.usesApi enables boot validation: without the sessions feature, the app
    // fails at boot instead of raising an opaque "handler not found" error
    // on the first restrict call.
    r.usesApi("sessions.revokeAllForUser");
    // file-foundation is a soft dependency: only the export worker needs it
    // for storage writes. Apps that use only forget (not export) do not need
    // to mount file-foundation.

    // GDPR-storage guards run whenever this feature is mounted; EXT_USER_DATA itself is framework-owned, so owner features register their hooks without requiring user-data-rights.
    r.bootCheck(({ features }) => validateGdprHookCompleteness(features));
    r.bootCheck(({ features }) => validateGdprMailAppName(features, opts));
    r.bootCheck(({ features }) => {
      validateGdprPiiHookCoverage(features);
      if (!warnedMissingMailDelivery && isMailTransportMountedWithoutDelivery(features)) {
        warnedMissingMailDelivery = true;
        createFallbackLogger("user-data-rights").warn(
          "mail-foundation and a mail transport are mounted but delivery/channel-email are not — the default export and deletion-request mails need them and will not be sent",
        );
      }
    });

    // App-level tenant-occupancy model. Default "multi-user" → tenant-scoped
    // contributors (e.g. credit) NEVER erase tenant data on a per-user forget
    // (would harm co-members). An app with one user per tenant sets this to
    // "single-user" via appOverrides (TENANT_MODEL_CONFIG_KEY) so the forget
    // pipeline may erase the tenant's data as that user's personal data — still
    // gated by a runtime sole-member check in run-forget-cleanup.
    r.config({
      keys: {
        tenantModel: createSystemConfig("select", {
          default: "multi-user",
          options: ["single-user", "multi-user"],
          env: "TENANT_MODEL",
        }),
      },
    });

    r.entity(exportJobEntity);
    r.entity(exportDownloadTokenEntity);
    r.entity(downloadAttemptEntity);

    // The login block for restricted users lives in auth-email-password/login.write.ts.
    r.writeHandler(restrictAccountWrite);
    r.writeHandler(liftRestrictionWrite);

    const tokenSecretOptions =
      opts.deletionTokenSecret !== undefined
        ? { deletionTokenSecret: opts.deletionTokenSecret }
        : {};
    const cancelLinkOptions = {
      ...tokenSecretOptions,
      ...(opts.deletionCancelUrl !== undefined && { deletionCancelUrl: opts.deletionCancelUrl }),
    };

    r.writeHandler(
      createRequestDeletionHandler({
        ...(opts.sendDeletionRequestedEmail && {
          sendDeletionRequestedEmail: opts.sendDeletionRequestedEmail,
        }),
        ...(opts.mailDefaults && { mailDefaults: opts.mailDefaults }),
        ...cancelLinkOptions,
      }),
    );
    r.writeHandler(cancelDeletionWrite);
    r.writeHandler(createCancelDeletionByTokenHandler(tokenSecretOptions));

    // Anonymous, email-verified deletion (lockout-safe): request-by-email sends a magic link, confirm-by-token starts the same grace period.
    r.writeHandler(
      createRequestDeletionByEmailHandler({
        ...(opts.deletionTokenSecret !== undefined && {
          deletionTokenSecret: opts.deletionTokenSecret,
        }),
        ...(opts.deletionVerifyUrl !== undefined && { deletionVerifyUrl: opts.deletionVerifyUrl }),
        ...(opts.mailDefaults && { mailDefaults: opts.mailDefaults }),
      }),
    );
    r.writeHandler(
      createConfirmDeletionByTokenHandler({
        ...(opts.sendDeletionRequestedEmail && {
          sendDeletionRequestedEmail: opts.sendDeletionRequestedEmail,
        }),
        ...(opts.mailDefaults && { mailDefaults: opts.mailDefaults }),
        ...cancelLinkOptions,
      }),
    );

    r.writeHandler(
      createRunForgetCleanupHandler({
        ...(opts.sendDeletionExecutedEmail && {
          sendDeletionExecutedEmail: opts.sendDeletionExecutedEmail,
        }),
        ...(opts.eraseOwnedRecordKeys === true && { eraseOwnedRecordKeys: true }),
      }),
    );
    r.exposesApi("userDataRights.runForget");

    r.writeHandler(requestExportWrite);
    r.queryHandler(exportStatusQuery);
    r.exposesApi("userDataRights.runExport");

    r.queryHandler(downloadByTokenQuery);
    r.queryHandler(downloadByJobQuery);

    r.queryHandler(myAuditLogQuery);
    r.queryHandler(listDownloadAttemptsQuery);

    // Read-only GDPR operator inspector (SystemAdmin) — screens stay inert until an app navs them.
    r.queryHandler(exportJobListQuery);
    r.queryHandler(exportJobDetailQuery);
    r.queryHandler(downloadAttemptListQuery);
    r.screen(exportJobListScreen);
    r.screen(exportJobDetailScreen);
    r.screen(downloadAttemptListScreen);

    r.nav({
      id: "export-job-list",
      label: "user-data-rights:nav.exportJobs",
      icon: "download",
      screen: UserDataRightsScreens.exportJobList,
      order: 25,
      adminArea: "platform",
      access: { roles: ["SystemAdmin"] },
    });

    r.translations({ keys: USER_DATA_RIGHTS_I18N });
    r.translations({ keys: USER_DATA_RIGHTS_HANDLER_I18N });
    registerGdprMails(r);

    r.translations({ keys: PRIVACY_CENTER_TRANSLATIONS });
    r.screen(privacyCenterScreen(showDeletion));
    registerExportDownloadRoutes(r);
    registerUserDataRightsJobs(r, opts, exportWarnings);
  });
}

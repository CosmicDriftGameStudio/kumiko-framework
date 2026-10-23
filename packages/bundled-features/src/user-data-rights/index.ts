export { deletionTokenSecretEnvSchema } from "./env.ts";
export { createUserDataRightsFeature, type UserDataRightsOptions } from "./feature.ts";
export type { SendDeletionVerificationEmailFn } from "./handlers/request-deletion-by-email.write.ts";
export {
  denyIfTargetOutsideAdminTenant,
  TARGET_USER_NOT_IN_ADMIN_TENANT,
} from "./lib/deny-if-target-outside-admin-tenant.ts";
export { isSystemAdminActor } from "./lib/is-admin-actor.ts";
// Reconcile existing data once before re-enabling read_users rebuilds.
// See the library documentation for the required procedure.
export { backfillUserLifecycleEvents, updateUserLifecycle } from "./lib/update-user-lifecycle.ts";
export type {
  SendExportFailedEmailFn,
  SendExportReadyEmailFn,
} from "./run-export-jobs.ts";
export type { SendDeletionExecutedEmailFn } from "./run-forget-cleanup.ts";
// Exported so app tests can run export/forget deterministically instead of
// waiting for the job cron.
// Shared retention-to-strategy mapping: other EXT_USER_DATA delete hooks that
// independently consult a DIFFERENT entity's retention (for example,
// notes-history-user-data's host-entity check) reuse this instead of
// re-deriving the anonymize/delete split.
export { policyToStrategy, runForgetCleanup } from "./run-forget-cleanup.ts";
export type { UserExportBundle } from "./run-user-export.ts";
export { runUserExport } from "./run-user-export.ts";
export { downloadAttemptEntity, downloadAttemptsTable } from "./schema/download-attempt.ts";
export {
  ACTIVE_JOB_CONSTRAINT,
  EXPORT_JOB_STATUS,
  type ExportJobStatus,
  exportJobEntity,
  exportJobsTable,
} from "./schema/export-job.ts";
export {
  TENANT_MODEL_CONFIG_KEY,
  USER_DATA_RIGHTS_FEATURE,
  UserDataRightsHandlers,
  UserDataRightsJobs,
  UserDataRightsQueries,
  UserDataRightsScreens,
} from "./web/constants.ts";

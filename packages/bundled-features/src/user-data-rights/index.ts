export { createUserDataRightsFeature, type UserDataRightsOptions } from "./feature";
export type { SendDeletionVerificationEmailFn } from "./handlers/request-deletion-by-email.write";
export {
  denyIfTargetOutsideAdminTenant,
  TARGET_USER_NOT_IN_ADMIN_TENANT,
} from "./lib/deny-if-target-outside-admin-tenant";
export { isSystemAdminActor } from "./lib/is-admin-actor";
// #494 Bestandsdaten-Reconcile — Apps rufen das einmalig vor dem Re-Enable
// von read_users-Rebuilds (siehe lib-Doc).
export { backfillUserLifecycleEvents, updateUserLifecycle } from "./lib/update-user-lifecycle";
export type {
  SendExportFailedEmailFn,
  SendExportReadyEmailFn,
} from "./run-export-jobs";
export type { SendDeletionExecutedEmailFn } from "./run-forget-cleanup";
// Runner-Exports — App-Tests dürfen export/forget deterministisch laufen
// lassen, statt über den Job-Cron zu warten (siehe sample
// user-data-rights-demo).
// Shared retention→strategy mapping (single source of truth per its own
// doc comment) — other EXT_USER_DATA delete hooks that must independently
// consult a DIFFERENT entity's retention (e.g. notes-history-user-data's
// host-entity check) reuse this instead of re-deriving the anonymize/delete
// split.
export { policyToStrategy, runForgetCleanup } from "./run-forget-cleanup";
export type { UserExportBundle } from "./run-user-export";
export { runUserExport } from "./run-user-export";
export {
  ACTIVE_JOB_CONSTRAINT,
  EXPORT_JOB_STATUS,
  type ExportJobStatus,
  exportJobEntity,
  exportJobsTable,
} from "./schema/export-job";

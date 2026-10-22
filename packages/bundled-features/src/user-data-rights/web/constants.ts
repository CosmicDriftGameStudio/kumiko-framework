// Pure string constants, client-marked so web/ (e.g. ExportSection) may
// import them without pulling the feature's runtime barrel (and with it its
// server/DOM-free code). Runtime code (feature.ts) may import client files
// anyway.

export const USER_DATA_RIGHTS_FEATURE = "user-data-rights" as const;

// Registered without r.nav — apps place it via their own r.nav. Qualified:
// `user-data-rights:screen:privacy-center`.
export const PRIVACY_CENTER_SCREEN_ID = "privacy-center" as const;

// Extension-section component name for the Export (Art. 20) section of the
// privacy-center screen — shared between feature.ts (screen def's
// `component: { react: { __component } }`) and web/client-plugin.tsx
// (extensionSectionComponents registration), same pattern as
// compliance-profiles' COMPLIANCE_PROFILE_CATALOG_EXTENSION_NAME.
export const EXPORT_SECTION_EXTENSION_NAME = "UserDataRightsExportSection" as const;

// enumOption keyPrefix for the privacy-center screen's `status` field
// pattern — resolves the raw user-lifecycle enum value
// (active/restricted/deletionRequested/deleted) to a translated label
// instead of showing the raw string.
export const STATUS_OPTION_KEY_PREFIX =
  "userDataRights.privacyCenter.field.status.option." as const;

export const UserDataRightsQueries = {
  exportStatus: "user-data-rights:query:export-status",
  myAuditLog: "user-data-rights:query:my-audit-log",
  downloadByJob: "user-data-rights:query:download-by-job",
  downloadByToken: "user-data-rights:query:download-by-token",
  listDownloadAttempts: "user-data-rights:query:list-download-attempts",
} as const;

// App-level config: tenant-occupancy model. "single-user" tells the forget
// pipeline that each tenant has exactly one user, so tenant-scoped contributors
// (e.g. credit) may erase the tenant's data as that user's personal data.
// Default "multi-user" (declared in feature.ts). Apps set it via appOverrides:
// `overrides.set(TENANT_MODEL_CONFIG_KEY, "single-user")`.
export const TENANT_MODEL_CONFIG_KEY = "user-data-rights:config:tenant-model" as const;

export const UserDataRightsHandlers = {
  requestExport: "user-data-rights:write:request-export",
  requestDeletion: "user-data-rights:write:request-deletion",
  requestDeletionByEmail: "user-data-rights:write:request-deletion-by-email",
  confirmDeletionByToken: "user-data-rights:write:confirm-deletion-by-token",
  cancelDeletion: "user-data-rights:write:cancel-deletion",
  restrictAccount: "user-data-rights:write:restrict-account",
  liftRestriction: "user-data-rights:write:lift-restriction",
  runForgetCleanup: "user-data-rights:write:run-forget-cleanup",
} as const;

// Foreign QN: the lifecycle status (active / deletionRequested / restricted)
// comes from the user feature. Pinned locally instead of importing the user
// runtime barrel (runtime isolation, like user-profile). Drift protection: the
// screen test compares against UserQueries.me.
export const USER_ME_QUERY = "user:query:user:me" as const;

// Client-safe mirror of EXPORT_JOB_STATUS (schema/export-job.ts is server-only
// via its Drizzle import). Drift protection: the screen test compares against
// the schema original.
export const EXPORT_JOB_STATUS = {
  Pending: "pending",
  Running: "running",
  Done: "done",
  Failed: "failed",
} as const;

export type ExportJobStatus = (typeof EXPORT_JOB_STATUS)[keyof typeof EXPORT_JOB_STATUS];

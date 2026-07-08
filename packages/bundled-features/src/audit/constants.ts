// @runtime client
// Qualified handler names + screen ids — shared by server feature and web client.
export const AUDIT_FEATURE = "audit" as const;

export const AuditQueries = {
  list: "audit:query:list",
  details: "audit:query:details",
} as const;

/** Tenant-admin audit log screen. Nav: `audit:screen:audit-log`. */
export const AUDIT_LOG_SCREEN_ID = "audit-log" as const;

/** Single-event detail screen, breadcrumb-linked to the audit-log list. */
export const AUDIT_LOG_DETAIL_SCREEN_ID = "audit-log-detail" as const;

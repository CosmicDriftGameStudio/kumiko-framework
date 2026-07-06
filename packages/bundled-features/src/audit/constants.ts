// @runtime client
// Qualified handler names + screen ids — shared by server feature and web client.
export const AUDIT_FEATURE = "audit" as const;

export const AuditQueries = {
  list: "audit:query:list",
} as const;

/** Tenant-admin audit log screen. Nav: `audit:screen:audit-log`. */
export const AUDIT_LOG_SCREEN_ID = "audit-log" as const;

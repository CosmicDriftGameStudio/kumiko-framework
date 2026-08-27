// @runtime client
// Qualified handler names + screen ids — shared by server feature and web client.
export const AUDIT_FEATURE = "audit" as const;

/** Literal `createdBy` written by hand-built system actors (secrets/jobs/…). */
export const SYSTEM_ACTOR_ID = "system" as const;

/** Literal `createdBy` for anonymous / unauthenticated actors. */
export const ANONYMOUS_USER_ID = "anonymous" as const;

/** All `createdBy` values that mean "system" in the audit UI (nil-UUID from createSystemUser + literal). */
export const SYSTEM_ACTOR_IDS: ReadonlySet<string> = new Set([
  SYSTEM_ACTOR_ID,
  "00000000-0000-0000-0000-000000000000",
]);

export const AuditQueries = {
  list: "audit:query:list",
  details: "audit:query:details",
} as const;

/** Tenant-admin audit log screen. Nav: `audit:screen:audit-log`. */
export const AUDIT_LOG_SCREEN_ID = "audit-log" as const;

/** Single-event detail screen, breadcrumb-linked to the audit-log list. */
export const AUDIT_LOG_DETAIL_SCREEN_ID = "audit-log-detail" as const;

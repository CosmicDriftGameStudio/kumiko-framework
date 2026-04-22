// Qualified handler names — kept in one place so tests/clients can reference
// the audit query without hard-coding the full string.
export const AUDIT_FEATURE = "audit" as const;

export const AuditQueries = {
  list: "audit:query:list",
} as const;

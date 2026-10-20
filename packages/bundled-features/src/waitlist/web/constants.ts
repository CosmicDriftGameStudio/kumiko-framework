// Pure string constants, safe for browser code (see auth-email-password/constants.ts).
export const WAITLIST_FEATURE = "waitlist" as const;

export const WAITLIST_STATUS = {
  Pending: "pending",
  Invited: "invited",
  Provisioned: "provisioned",
  Rejected: "rejected",
} as const;

export type WaitlistStatus = (typeof WAITLIST_STATUS)[keyof typeof WAITLIST_STATUS];

export const WaitlistHandlers = {
  submit: "waitlist:write:submit",
  invite: "waitlist:write:invite",
  reject: "waitlist:write:reject",
  export: "waitlist:write:export",
  purge: "waitlist:write:purge",
} as const;

// Entity-convention list QN: entityList screens resolve their query by this shape.
export const WaitlistQueries = {
  list: "waitlist:query:waitlist-entry:list",
} as const;

export const WaitlistErrors = {
  notInvitable: "waitlist_not_invitable",
  notRejectable: "waitlist_not_rejectable",
  confirmCountMismatch: "waitlist_confirm_count_mismatch",
} as const;

export const WAITLIST_NOTIFICATION_TYPES = {
  confirmation: "waitlist:notify:confirmation",
  adminNotice: "waitlist:notify:admin-notice",
} as const;

export const DEFAULT_OWN_TENANT_INVITE_ROLE = "TenantAdmin";

export const WAITLIST_FIELD_LIMITS = {
  name: 120,
  email: 254,
  company: 200,
  portfolio: 200,
  message: 2000,
  locale: 35,
  honeypot: 500,
} as const;

// Audit trail for the export/purge handlers: own aggregate per occurrence, payload
// carries counts only (never addresses).
export const WAITLIST_EXPORTED_EVENT_SHORT = "exported" as const;
export const WAITLIST_PURGED_EVENT_SHORT = "purged" as const;
export const WAITLIST_EXPORTED_EVENT_QN = "waitlist:event:exported" as const;
export const WAITLIST_PURGED_EVENT_QN = "waitlist:event:purged" as const;
export const WAITLIST_AUDIT_AGGREGATE_TYPE = "waitlist-audit" as const;

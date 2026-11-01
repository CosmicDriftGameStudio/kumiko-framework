export const TENANT_INACTIVITY_FEATURE = "tenant-inactivity";
export const TENANT_INACTIVITY_STATE_ENTITY = "tenant-inactivity-state";
// Same roles that may request or cancel the account destruction.
export const INACTIVITY_MAIL_ROLES = ["TenantOwner", "Admin"] as const;

export const TenantInactivityJobs = {
  check: `${TENANT_INACTIVITY_FEATURE}:job:check-inactive-tenants`,
} as const;

export const TenantInactivityHandlers = {
  keepAccount: `${TENANT_INACTIVITY_FEATURE}:write:keep-account`,
  state: `${TENANT_INACTIVITY_FEATURE}:query:state`,
} as const;

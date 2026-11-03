export const TENANT_INACTIVITY_FEATURE = "tenant-inactivity";
export const TENANT_INACTIVITY_STATE_ENTITY = "tenant-inactivity-state";

// Stays import-free for the client-safe subpath; a test ties it to TENANT_ACCOUNT_CLOSE_ROLES.
export const TENANT_KEEP_ACCOUNT_ROLES = ["TenantOwner", "TenantAdmin", "Admin"] as const;

export const TenantInactivityJobs = {
  check: `${TENANT_INACTIVITY_FEATURE}:job:check-inactive-tenants`,
} as const;

export const TenantInactivityHandlers = {
  keepAccount: `${TENANT_INACTIVITY_FEATURE}:write:keep-account`,
  state: `${TENANT_INACTIVITY_FEATURE}:query:state`,
} as const;

export const TENANT_INACTIVITY_FEATURE = "tenant-inactivity";
export const TENANT_INACTIVITY_STATE_ENTITY = "tenant-inactivity-state";
export const TENANT_OWNER_ROLE = "TenantOwner";

export const TenantInactivityJobs = {
  check: `${TENANT_INACTIVITY_FEATURE}:job:check-inactive-tenants`,
} as const;

export const TenantInactivityHandlers = {
  keepAccount: `${TENANT_INACTIVITY_FEATURE}:write:keep-account`,
  state: `${TENANT_INACTIVITY_FEATURE}:query:state`,
} as const;

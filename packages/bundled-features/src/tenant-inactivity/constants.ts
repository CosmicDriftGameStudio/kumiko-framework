export const TENANT_INACTIVITY_FEATURE = "tenant-inactivity";
export const TENANT_INACTIVITY_STATE_ENTITY = "tenant-inactivity-state";

// Everyone who may react to the warning: the account-close roles plus TenantAdmin, so the mail
// reaches exactly the people who can open the keep-account link and read the state.
export const TENANT_KEEP_ACCOUNT_ROLES = ["TenantOwner", "TenantAdmin", "Admin"] as const;

export const TenantInactivityJobs = {
  check: `${TENANT_INACTIVITY_FEATURE}:job:check-inactive-tenants`,
} as const;

export const TenantInactivityHandlers = {
  keepAccount: `${TENANT_INACTIVITY_FEATURE}:write:keep-account`,
  state: `${TENANT_INACTIVITY_FEATURE}:query:state`,
} as const;

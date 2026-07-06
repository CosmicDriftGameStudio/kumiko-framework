// @runtime client
export const COMPLIANCE_PROFILES_FEATURE = "compliance-profiles" as const;

export const ComplianceProfileHandlers = {
  setProfile: "compliance-profiles:write:set-profile",
} as const;

export const ComplianceProfileQueries = {
  forTenant: "compliance-profiles:query:for-tenant",
  listProfiles: "compliance-profiles:query:list-profiles",
  needsProfile: "compliance-profiles:query:needs-profile",
  subProcessors: "compliance-profiles:query:sub-processors",
} as const;

export const COMPLIANCE_PROFILE_SCREEN_ID = "profile-picker" as const;

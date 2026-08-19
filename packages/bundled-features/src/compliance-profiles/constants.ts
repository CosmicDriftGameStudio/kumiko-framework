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

// Extension-section component name for the profile-catalog block under the
// picker's select field — registered client-side via
// complianceProfilesClient()'s extensionSectionComponents.
export const COMPLIANCE_PROFILE_CATALOG_EXTENSION_NAME = "ComplianceProfileCatalog" as const;

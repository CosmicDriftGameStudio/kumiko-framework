// Central role constants for the platform.
//
// Background: Bundled features have drifted between "Admin" (text-content,
// secrets, ai-foundation, file-provider-s3) and "TenantAdmin" (tenant-
// handler, publicstatus, platform), which can trap app builders.
// This file is the single source of truth. Bundled features are migrated
// gradually to the ROLES constants at touchpoints where they are already
// being changed.
//
// Canonical names:
//   TenantOwner            — Full tenant authority; the only role allowed
//                            to trigger tenant destruction.
//   TenantAdmin            — Tenant configuration and user management.
//                            The existing "Admin" string is migrated
//                            to this role.
//   DataProtectionOfficer  — DPO; sets legal holds and can view the
//                            authority audit stream even in silentMode.
//   SystemAdmin            — Platform operator (NOT tenant-scoped).
//                            Authority export, KMS recovery, cross-tenant
//                            setup. Matches the existing "SystemAdmin"
//                            string in text-content, secrets,
//                            auth-email-password, etc.
//   Member                 — Standard tenant member without
//                            administrative rights.

/**
 * Platform-wide standardized role names. All privacy-related code uses
 * these constants exclusively instead of string literals.
 */
export const ROLES = {
  TenantOwner: "TenantOwner",
  TenantAdmin: "TenantAdmin",
  DataProtectionOfficer: "DataProtectionOfficer",
  SystemAdmin: "SystemAdmin",
  Member: "Member",
} as const;

/**
 * Union of all known role names for compile-time checks of
 * handler access rules and ownership maps.
 */
export type Role = (typeof ROLES)[keyof typeof ROLES];

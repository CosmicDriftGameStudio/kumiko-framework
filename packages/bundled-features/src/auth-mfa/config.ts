// Tenant-scoped enforcement policy: does a user need MFA to log in even if
// they haven't opted in themselves? Default "optional" means the feature
// is fully opt-in (existing tenants/users unaffected — no migration step).
//
// Every non-optional policy blocks login for an unenrolled matching user until
// they finish the pre-auth enrollment step (mfa-status-checker.ts setupRequired).
import {
  access,
  type ConfigKeyHandle,
  createTenantConfig,
} from "@cosmicdrift/kumiko-framework/engine";

export const MFA_REQUIRED_POLICIES = ["optional", "systemAdmins", "admins", "all"] as const;
export type MfaRequiredPolicy = (typeof MFA_REQUIRED_POLICIES)[number];

export const mfaRequiredConfigHandle: ConfigKeyHandle<"select"> = {
  name: "auth-mfa:config:required",
  type: "select",
};

// Write access is machine-only: a TenantAdmin must not be able to relax the
// policy back to "optional". The app-wide default comes from
// `createAuthMfaFeature({ requiredPolicy })`, per-tenant overrides are set by
// system writes (runBootstrap `tenants[].config`, jobs, SystemAdmin tooling).
export function mfaRequiredConfigKey(defaultPolicy: MfaRequiredPolicy = "optional") {
  return createTenantConfig("select", {
    default: defaultPolicy,
    options: [...MFA_REQUIRED_POLICIES],
    write: access.system,
  });
}

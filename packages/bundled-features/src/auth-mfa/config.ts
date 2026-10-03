// Tenant-scoped enforcement policy: does a user need MFA to log in even if
// they haven't opted in themselves? Default "optional" means the feature
// is fully opt-in (existing tenants/users unaffected — no migration step).
//
// ponytail: "admins"/"all" HARD-BLOCK login for an unenrolled user (see
// mfa-status-checker.ts's setupRequired branch) — there is no in-band way
// for a blocked user to complete enrollment yet (that flow ships in PR3's
// UI). Flipping this away from "optional" before PR3 locks out every
// unenrolled matching user with no recovery path. Fine for a tenant that
// enrolls its admins out-of-band first; a footgun otherwise.
import {
  access,
  type ConfigKeyHandle,
  createTenantConfig,
} from "@cosmicdrift/kumiko-framework/engine";

export const MFA_REQUIRED_POLICIES = ["optional", "admins", "all"] as const;
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

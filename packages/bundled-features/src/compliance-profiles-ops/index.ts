// compliance-profiles-ops — platform-wide SystemAdmin visibility into
// tenants missing a compliance-profile selection (#2089).
//
// needs-profile (compliance-profiles) tells a TenantAdmin they must pick a
// profile, but stays TenantAdmin-only by design (#2084) — a SystemAdmin who
// owns a picker narrowed to access.systemAdmin has no query at all. Kept as
// a separate feature (mirrors folders-user-data/notes-history-user-data)
// rather than folded into compliance-profiles: this is the one genuinely
// cross-tenant capability in the picker's orbit, and it alone needs
// r.systemScope() + a hard r.requires("tenant") — apps that only want the
// per-tenant picker (the vast majority) stay unaffected.

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { tenantsMissingProfileQuery } from "./handlers/tenants-missing-profile.query";

export const complianceProfilesOpsFeature = defineFeature("compliance-profiles-ops", (r) => {
  r.describe(
    "Platform-wide SystemAdmin counterpart to `compliance-profiles`' `needs-profile` query (#2089): `tenants-missing-profile` lists every enabled tenant with no row in `tenantComplianceProfile` at all, tenant-wide instead of scoped to the caller's own tenant. Mount alongside `compliance-profiles` and `tenant` when an operator UI needs to see which tenants still silently run on `minimal-no-region`.",
  );
  r.uiHints({
    displayLabel: "Compliance Profiles · Operator Visibility",
    category: "compliance",
    recommended: false,
  });
  r.systemScope();
  r.requires("compliance-profiles");
  r.requires("tenant");

  const queries = {
    tenantsMissingProfile: r.queryHandler(tenantsMissingProfileQuery),
  };

  return { queries };
});

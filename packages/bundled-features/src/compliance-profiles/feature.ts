import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { forTenantQuery } from "./handlers/for-tenant.query";
import { listProfilesQuery } from "./handlers/list-profiles.query";
import { needsProfileQuery } from "./handlers/needs-profile.query";
import { setProfileWrite } from "./handlers/set-profile.write";
import { subProcessorsQuery } from "./handlers/sub-processors.query";
import { tenantComplianceProfileEntity } from "./schema/profile-selection";

export {
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "./schema/profile-selection";

// compliance-profiles — Tenant-weite DSGVO/Compliance-Profile-Wahl.
//
// Pflicht beim Tenant-Onboarding (Sprint 1.5 Banner-API). Profile
// buendelt User-Rights-Grace, Notification-Sprache, Breach-Disclosure,
// Audit-Retention und Sub-Processor-Anforderungen.
//
// Cross-Feature-API: r.exposesApi("compliance.forTenant") — andere
// Features (user-data-rights in Sprint 2, tenant-lifecycle in Sprint 5)
// rufen den Profile-Resolver via QN-Pattern (siehe legal-pages →
// text-content fuer Pattern-Beispiel).
//
// Architektur-Note: Profile-Selection lebt als separate Entity
// (tenantComplianceProfile), nicht als config-key im tenant-Feature.
// Begruendung in schema/profile-selection.ts.
export function createComplianceProfilesFeature(): FeatureDefinition {
  return defineFeature("compliance-profiles", (r) => {
    r.describe(
      "Lets each tenant select a compliance regime (e.g. `eu-dsgvo`, `swiss-dsg`, `de-hr-dsgvo-hgb`) that bundles user-rights grace periods, breach-disclosure deadlines, sub-processor requirements, and audit-retention rules into a single named profile. Tenant admins call `compliance-profiles:write:set-profile` to choose a profile (with optional JSON override for edge cases); other features resolve the effective profile via the `compliance.forTenant` cross-feature API. Required by `user-data-rights` \u2014 mount this feature before it.",
    );
    // Standalone — kein r.requires noetig: tenantId kommt aus dem User-
    // Context, Profile-Selection ist eigene Entity, sub-processor-Liste
    // sind Constants. Wenn S1.4+ Cross-Feature-Reads dazukommen, kommt
    // r.requires hier rein.
    r.entity("tenant-compliance-profile", tenantComplianceProfileEntity);

    r.exposesApi("compliance.forTenant");

    const handlers = {
      setProfile: r.writeHandler(setProfileWrite),
    };

    const queries = {
      forTenant: r.queryHandler(forTenantQuery),
      listProfiles: r.queryHandler(listProfilesQuery),
      subProcessors: r.queryHandler(subProcessorsQuery),
      needsProfile: r.queryHandler(needsProfileQuery),
    };

    return { handlers, queries };
  });
}

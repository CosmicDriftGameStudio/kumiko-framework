import {
  access,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { COMPLIANCE_PROFILE_SCREEN_ID } from "./constants";
import { forTenantQuery } from "./handlers/for-tenant.query";
import { listProfilesQuery } from "./handlers/list-profiles.query";
import { createNeedsProfileQuery } from "./handlers/needs-profile.query";
import { setProfileWrite } from "./handlers/set-profile.write";
import { subProcessorsQuery } from "./handlers/sub-processors.query";
import { COMPLIANCE_PROFILES_I18N } from "./i18n";
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
export type ComplianceProfilesFeatureOptions = {
  // Access gate for the profile-picker screen and the `set-profile` write it
  // submits to — both move together so the nav entry a role sees always
  // matches a callable handler (#2033). Default access.admin includes
  // TenantAdmin, who in a line-of-business app is the operator, not the
  // platform — pass access.systemAdmin to keep this platform-only and out
  // of their nav.
  readonly access?: readonly string[];
};

export function createComplianceProfilesFeature(
  options?: ComplianceProfilesFeatureOptions,
): FeatureDefinition {
  const resolvedAccess = options?.access ?? access.admin;
  return defineFeature("compliance-profiles", (r) => {
    r.describe(
      "Lets each tenant select a compliance regime (e.g. `eu-dsgvo`, `swiss-dsg`, `de-hr-dsgvo-hgb`) that bundles user-rights grace periods, breach-disclosure deadlines, sub-processor requirements, and audit-retention rules into a single named profile. Tenant admins call `compliance-profiles:write:set-profile` to choose a profile (with optional JSON override for edge cases); other features resolve the effective profile via the `compliance.forTenant` cross-feature API. Required by `user-data-rights` \u2014 mount this feature before it.",
    );
    r.uiHints({
      displayLabel: "Compliance Profiles",
      category: "compliance",
      recommended: false,
    });
    // Standalone — kein r.requires noetig: tenantId kommt aus dem User-
    // Context, Profile-Selection ist eigene Entity, sub-processor-Liste
    // sind Constants. Wenn S1.4+ Cross-Feature-Reads dazukommen, kommt
    // r.requires hier rein.
    r.entity("tenant-compliance-profile", tenantComplianceProfileEntity);

    r.exposesApi("compliance.forTenant");

    const handlers = {
      setProfile: r.writeHandler({ ...setProfileWrite, access: { roles: resolvedAccess } }),
    };

    const queries = {
      forTenant: r.queryHandler(forTenantQuery),
      listProfiles: r.queryHandler(listProfilesQuery),
      subProcessors: r.queryHandler(subProcessorsQuery),
      needsProfile: r.queryHandler(createNeedsProfileQuery(resolvedAccess)),
    };

    r.screen({
      id: COMPLIANCE_PROFILE_SCREEN_ID,
      type: "custom",
      renderer: { react: { __component: "ComplianceProfileScreen" } },
      access: { roles: resolvedAccess },
    });
    r.nav({
      id: "profile-picker",
      label: "compliance-profiles:nav.profilePicker",
      screen: "compliance-profiles:screen:profile-picker",
      order: 50,
    });

    r.translations({ keys: COMPLIANCE_PROFILES_I18N });

    return { handlers, queries };
  });
}

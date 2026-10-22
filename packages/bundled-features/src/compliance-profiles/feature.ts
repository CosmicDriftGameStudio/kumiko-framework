import { SELECTABLE_PROFILE_KEYS } from "@cosmicdrift/kumiko-framework/compliance";
import {
  access,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { forTenantQuery } from "./handlers/for-tenant.query.ts";
import { listProfilesQuery } from "./handlers/list-profiles.query.ts";
import { createNeedsProfileQuery } from "./handlers/needs-profile.query.ts";
import { setProfileWrite } from "./handlers/set-profile.write.ts";
import { subProcessorsQuery } from "./handlers/sub-processors.query.ts";
import { COMPLIANCE_PROFILES_I18N } from "./i18n.ts";
import { tenantComplianceProfileEntity } from "./schema/profile-selection.ts";
import {
  COMPLIANCE_PROFILE_CATALOG_EXTENSION_NAME,
  COMPLIANCE_PROFILE_SCREEN_ID,
  ComplianceProfileHandlers,
} from "./web/constants.ts";

export {
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "./schema/profile-selection.ts";

// compliance-profiles — Tenant-wide GDPR/compliance profile selection.
//
// Required during tenant onboarding. Each profile bundles user-rights grace
// periods, notification language, breach-disclosure rules, audit retention,
// and sub-processor requirements.
//
// Cross-feature API: r.exposesApi("compliance.forTenant") — other features
// resolve the profile through the QN pattern (see legal-pages → text-content
// for an example).
//
// Architectural note: Profile selection is stored as a separate entity
// (tenantComplianceProfile), not as a config key in the tenant feature.
// The reason is documented in schema/profile-selection.ts.
export type ComplianceProfilesFeatureOptions = {
  // Access gate for the profile-picker screen and the `set-profile` write it
  // submits to — both move together so the nav entry a role sees always
  // matches a callable handler. Default access.admin includes
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
    // Standalone — r.requires is not needed: tenantId comes from the user
    // context, profile selection is a separate entity, and the sub-processor
    // list consists of constants. Add r.requires if cross-feature reads are
    // introduced.
    r.entity({ name: "tenant-compliance-profile", ...tenantComplianceProfileEntity });

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
      type: "actionForm",
      handler: ComplianceProfileHandlers.setProfile,
      fields: {
        profileKey: { type: "select", options: SELECTABLE_PROFILE_KEYS, required: true },
      },
      layout: {
        width: "full",
        sections: [
          { fields: ["profileKey"] },
          {
            kind: "extension",
            title: "compliance-profiles:profile.catalog.title",
            component: { react: { __component: COMPLIANCE_PROFILE_CATALOG_EXTENSION_NAME } },
          },
        ],
      },
      submitLabel: "compliance-profiles:profile.actions.save",
      access: { roles: resolvedAccess },
    });
    r.nav({
      id: "profile-picker",
      label: "compliance-profiles:nav.profilePicker",
      screen: "compliance-profiles:screen:profile-picker",
      icon: "shield-check",
      order: 50,
    });

    r.translations({ keys: COMPLIANCE_PROFILES_I18N });

    return { handlers, queries };
  });
}

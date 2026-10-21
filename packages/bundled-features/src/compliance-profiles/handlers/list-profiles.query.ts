import {
  COMPLIANCE_PROFILES,
  type ComplianceProfile,
  type ComplianceProfileKey,
  SELECTABLE_PROFILE_KEYS,
} from "@cosmicdrift/kumiko-framework/compliance";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";

// Returns all selectable compliance profiles for tenant onboarding.
// Pure in-memory read of the constants—no database query or caching is needed
// because they are already resolved before boot.
//
// Excludes minimal-no-region because it is the default fallback, not selectable;
// production must make an explicit choice.
export const listProfilesQuery = defineQueryHandler({
  name: "list-profiles",
  schema: z.object({}),
  access: {
    openToAll: {
      reason:
        "any signed-in user may list the selectable compliance profiles; the data is " +
        "static, deployment-wide reference information, not tenant- or user-specific",
    },
  },
  description:
    "Lists the compliance profiles a tenant can choose from (key, region, label, supervisory-authority contact, notification languages), for rendering the onboarding profile picker; the minimal-no-region fallback is excluded because it is not selectable.",
  handler: async (): Promise<{ profiles: readonly ComplianceProfileSummary[] }> => {
    return {
      profiles: SELECTABLE_PROFILE_KEYS.map(toSummary),
    };
  },
});

interface ComplianceProfileSummary {
  readonly key: ComplianceProfileKey;
  readonly region: string;
  readonly label: string;
  readonly authorityContact: string;
  readonly languages: readonly string[];
}

function toSummary(key: ComplianceProfileKey): ComplianceProfileSummary {
  const p: ComplianceProfile = COMPLIANCE_PROFILES[key];
  return {
    key: p.key,
    region: p.region,
    label: p.label,
    authorityContact: p.breach.authorityContact,
    languages: p.notifications.languages,
  };
}

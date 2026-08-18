// @runtime client
// Default-Bundles für den TierAdminScreen. Werden vom tierEngineClient()
// als Fallback-Bundle in den LocaleProvider gehängt — Apps überschreiben
// einzelne Keys via `tierEngineClient({ translations })`.

import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

type LocalizedString = { readonly en: string };

export const TIER_ENGINE_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:tier-admin.title": { en: "Assign tier manually" },
};

export const defaultTranslations: TranslationsByLocale = {
  en: {
    "screen:tier-admin.title": "Assign tier manually",
    "tier-admin.title": "Assign tier manually",
    "tier-admin.explainer":
      "Grant a tenant a tier without a purchase. The grant is marked as “manual” and a later billing sync won't overwrite it.",
    "tier-admin.tenant.label": "Tenant",
    "tier-admin.current.label": "Current tier",
    "tier-admin.current.none": "— none yet —",
    "tier-admin.tier.label": "New tier",
    "tier-admin.submit": "Assign tier",
    "tier-admin.success": "Assigned tier “{tier}”.",
    "tier-admin.error.generic": "Could not assign the tier.",
    "tier-admin.error.load": "Failed to load tenants.",
    "tier-admin.error.noTiers":
      "This app has no TierMap configured — there are no assignable tiers.",
  },
};

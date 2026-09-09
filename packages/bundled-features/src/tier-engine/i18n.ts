// @runtime client
// Server + client i18n for the tier-admin actionForm. Single source of
// truth: r.translations({ keys: TIER_ENGINE_I18N }) registers these
// server-side, defaultTranslations derives the client-side locale bundle
// from the same map so the two can't drift.

import {
  type TranslationsByLocale,
  translationsByLocaleFromKeys,
} from "@cosmicdrift/kumiko-renderer";

type LocalizedString = { readonly en: string };

export const TIER_ENGINE_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:tier-admin.title": { en: "Assign tier manually" },
  "tier-admin.explainer": {
    en: "Grant a tenant a tier without a purchase. The grant is marked as “manual” and a later billing sync won't overwrite it.",
  },
  "tier-admin.error.noTiers": {
    en: "This app has no TierMap configured — there are no assignable tiers.",
  },
  "tier-engine:entity:__action-form__:field:tenantId": { en: "Tenant" },
  "tier-engine:entity:__action-form__:field:tier": { en: "New tier" },
  "tier-admin.submit": { en: "Assign tier" },
};

export const defaultTranslations: TranslationsByLocale =
  translationsByLocaleFromKeys(TIER_ENGINE_I18N);

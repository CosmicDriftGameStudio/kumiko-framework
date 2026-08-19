import {
  COMPLIANCE_PROFILES,
  SELECTABLE_PROFILE_KEYS,
} from "@cosmicdrift/kumiko-framework/compliance";

type LocalizedString = { readonly en: string };

// Option labels for the actionForm's `profileKey` select — derived from
// SELECTABLE_PROFILE_KEYS so a new selectable profile picks up its i18n
// label automatically instead of needing a second hardcoded list here.
const PROFILE_OPTION_KEYS: Readonly<Record<string, LocalizedString>> = Object.fromEntries(
  SELECTABLE_PROFILE_KEYS.map((key) => [
    `compliance-profiles:entity:__action-form__:field:profileKey:option:${key}`,
    { en: COMPLIANCE_PROFILES[key].label },
  ]),
);

export const COMPLIANCE_PROFILES_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:profile-picker.title": { en: "Compliance profile" },
  "compliance-profiles:nav.profilePicker": { en: "Compliance" },
  // Field label + option labels for the actionForm's synthesized pseudo-
  // entity (`__action-form__`, see action-form-shim.ts) — required by the
  // i18n boot-validator (requiredKeysFromScreen) and must live in the
  // server-registered translations, not the client bundle's own i18n: the
  // declarative actionForm renderer resolves these through the schema
  // payload, not through a custom screen component's client-side t().
  "compliance-profiles:entity:__action-form__:field:profileKey": { en: "Compliance profile" },
  "compliance-profiles:profile.actions.save": { en: "Save profile" },
  "compliance-profiles:profile.catalog.title": { en: "Available profiles" },
  ...PROFILE_OPTION_KEYS,
};

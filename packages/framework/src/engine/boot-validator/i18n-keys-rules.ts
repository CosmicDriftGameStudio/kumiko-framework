import type { BootRuleTable } from "./boot-rule.ts";

export const I18N_RULES = {
  missingFeatureKey: {
    id: "i18n/missing-feature-key",
    summary: "Every translation key a feature surface requires is defined.",
    fix: "Add the key via r.translations(...) in the feature.",
  },
  missingSettingsHubKey: {
    id: "i18n/missing-settings-hub-key",
    summary: "Every translation key the generated settings hub requires is defined.",
    fix: "Add the key via r.translations(...) in the owning feature.",
  },
  localeInconsistent: {
    id: "i18n/locale-inconsistent",
    summary: "Every locale a feature uses is maintained for every one of its translation keys.",
    fix: "Add the missing locale to the key, or move that locale into a locale package.",
  },
  missingRequiredLocale: {
    id: "i18n/missing-required-locale",
    summary: "Every translation key exists in every locale the app requires.",
    fix: "Load the matching locale package or add the missing translations.",
  },
  missingFieldValueTranslation: {
    id: "i18n/missing-field-value-translation",
    summary:
      "With requireFieldValueTranslations, select options and embedded cells are translated.",
    fix: "Add the keys via r.translations(...) in the owning feature.",
  },
} as const satisfies BootRuleTable;

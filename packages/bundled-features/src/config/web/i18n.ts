// @runtime client
// Default labels for the auto-generated Settings-Hub. The generator
// (buildConfigFeatureSchema) emits `config.settings.<scope>` for the audience
// groups and `config.settings.title` for the synthetic workspace — generic
// across every app, so they ship here. configClient() hangs them into the
// LocaleProvider as a fallback; an app overrides individual keys via
// configClient({ translations: { de: { ... } } }). The app only adds labels
// for ITS keys (mask.title) and the per-feature group key `<feature>.settings`.

import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

export const defaultTranslations: TranslationsByLocale = {
  de: {
    "config.settings.title": "Einstellungen",
    "config.settings.system": "Plattform",
    "config.settings.tenant": "Organisation",
    "config.settings.user": "Persönlich",
  },
  en: {
    "config.settings.title": "Settings",
    "config.settings.system": "Platform",
    "config.settings.tenant": "Organization",
    "config.settings.user": "Personal",
  },
};

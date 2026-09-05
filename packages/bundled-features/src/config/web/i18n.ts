// @runtime client
// Default labels for the auto-generated Settings-Hub. The generator
// (buildConfigFeatureSchema) emits `config.settings.<scope>` for the audience
// groups and `config.settings.title` for the synthetic workspace — generic
// across every app, so they ship here. configClient() hangs them into the
// LocaleProvider as a fallback; an app overrides individual keys via
// configClient({ translations }). The app only adds labels
// for ITS keys (mask.title) and the per-feature group key `<feature>.settings`.

import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

export const defaultTranslations: TranslationsByLocale = {
  en: {
    "config.secrets.delete": "Delete",
    "config.secrets.notSet": "Not set",
    "config.secrets.placeholder": "Enter a value",
    "config.secrets.replacePlaceholder": "Enter a new value to replace",
    "config.secrets.required": "Required",
    "config.secrets.set": "Set",
    "config.secrets.title": "Secrets",
    "config.settings.title": "Settings",
    "config.settings.system": "Platform",
    "config.settings.tenant": "Tenant",
    "config.settings.user": "Personal",
    "config.errors.systemOnly": "This value can only be set by the system.",
    "config.errors.invalidScope": "This scope is not allowed for this key.",
    "config.errors.unknownKey": "Unknown configuration key.",
    // Required by every generated screen (screenTitleKey, required-surface-keys.ts) —
    // the secrets screen has a fixed id ("secrets"), so the framework ships its
    // title translation directly instead of asking every app to declare it.
    "screen:secrets.title": "Secrets",
  },
};

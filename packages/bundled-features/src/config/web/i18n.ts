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
    "config.secrets.delete": "Remove",
    "config.secrets.deleteConfirm":
      "Remove this secret? Anything using it stops working, and it cannot be restored.",
    "config.secrets.notSet": "Not set",
    "config.secrets.placeholder": "Enter a value",
    "config.secrets.replacePlaceholder": "Enter a new value to replace it",
    "config.secrets.saved": "Saved",
    "config.secrets.section": "Secrets",
    "config.secrets.description": "Stored encrypted. Saved values are never shown again.",
    "config.secrets.stored": "Stored: {preview}",
    "config.secrets.set": "Set",
    "config.secrets.title": "Secrets",
    "config.settings.title": "Settings",
    "config.settings.system": "Platform",
    "config.settings.tenant": "Tenant",
    "config.settings.user": "Personal",
    "config.errors.systemOnly": "This value can only be set by the system.",
    "config.errors.invalidScope": "This scope is not allowed for this key.",
    "config.errors.unknownKey": "Unknown configuration key.",
    "config.errors.unknownExtensionPlugin": "This provider is not available.",
    "config.settings.extensionSelectorHint":
      "Choose a provider and save. Its settings appear below.",
    "config.settings.provider": "Provider",
    "config.settings.saveProvider": "Save provider",
    "config.settings.audience.system":
      "Applies to every tenant unless a tenant sets its own value.",
    "config.settings.audience.tenant":
      "Applies to everyone in this tenant. Platform defaults are shown where nothing is set here.",
    "config.settings.audience.user": "Only applies to you.",
    // Required by every generated screen (screenTitleKey, required-surface-keys.ts) —
    // the secrets screen has a fixed id ("secrets"), so the framework ships its
    // title translation directly instead of asking every app to declare it.
    "screen:secrets.title": "Secrets",
  },
};

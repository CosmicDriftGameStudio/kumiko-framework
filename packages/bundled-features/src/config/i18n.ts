type LocalizedString = { readonly de: string; readonly en: string };

/** Server boot keys for the auto-generated Settings-Hub (mirrors web/i18n.ts). */
export const CONFIG_FEATURE_I18N: Readonly<Record<string, LocalizedString>> = {
  "config.settings.title": { de: "Einstellungen", en: "Settings" },
  "config.settings.system": { de: "Plattform", en: "Platform" },
  "config.settings.tenant": { de: "Organisation", en: "Organization" },
  "config.settings.user": { de: "Persönlich", en: "Personal" },
};

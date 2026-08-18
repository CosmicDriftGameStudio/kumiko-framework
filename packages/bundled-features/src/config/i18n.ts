type LocalizedString = { readonly de: string; readonly en: string; readonly es: string };

/** Server boot keys for the auto-generated Settings-Hub (mirrors web/i18n.ts). */
export const CONFIG_FEATURE_I18N: Readonly<Record<string, LocalizedString>> = {
  "config.settings.title": { de: "Einstellungen", en: "Settings", es: "Ajustes" },
  "config.settings.system": { de: "Plattform", en: "Platform", es: "Plataforma" },
  "config.settings.tenant": { de: "Organisation", en: "Organization", es: "Organización" },
  "config.settings.user": { de: "Persönlich", en: "Personal", es: "Personal" },
};

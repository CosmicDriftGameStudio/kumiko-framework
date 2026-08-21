type LocalizedString = { readonly en: string };

/** Server boot keys for the auto-generated Settings-Hub (mirrors web/i18n.ts). */
export const CONFIG_FEATURE_I18N: Readonly<Record<string, LocalizedString>> = {
  "config.settings.title": { en: "Settings" },
  "config.settings.system": { en: "Platform" },
  "config.settings.tenant": { en: "Tenant" },
  "config.settings.user": { en: "Personal" },
};

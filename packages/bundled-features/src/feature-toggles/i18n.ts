type LocalizedString = { readonly de: string; readonly en: string };

export const FEATURE_TOGGLES_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:toggle-admin.title": { de: "Feature-Toggles", en: "Feature toggles" },
  "feature-toggles:nav.toggleAdmin": { de: "Feature-Toggles", en: "Feature toggles" },
};

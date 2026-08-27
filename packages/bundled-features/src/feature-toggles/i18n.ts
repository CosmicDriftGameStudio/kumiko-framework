type LocalizedString = { readonly en: string };

export const FEATURE_TOGGLES_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:toggle-admin.title": { en: "Feature toggles" },
  "feature-toggles:nav.toggleAdmin": { en: "Feature toggles" },
  "feature-toggles.admin.col.feature": { en: "Feature" },
  "feature-toggles.admin.col.default": { en: "Default" },
  "feature-toggles.admin.col.override": { en: "Override" },
  "feature-toggles.admin.col.effective": { en: "Effective" },
  "feature-toggles.admin.toggle": { en: "Toggle" },
};

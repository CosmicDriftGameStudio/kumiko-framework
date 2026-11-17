export const BRANDING_FEATURE = "branding" as const;
export const BRANDING_CSS_FEATURE = "branding-css" as const;
export const LAYOUT_PRESETS = ["minimal", "centered", "wide"] as const;

export const BRANDING_QN = {
  title: "branding:config:title",
  description: "branding:config:description",
  siteUrl: "branding:config:site-url",
  accentColor: "branding:config:accent-color",
  logoUrl: "branding:config:logo-url",
  logoFile: "branding:config:logo-file",
  layoutPreset: "branding:config:layout-preset",
  customCss: "branding:config:custom-css",
} as const;

export const BRANDING_TOKENS_QUERY_QN = "branding:query:tokens" as const;
export const BRANDING_SETTINGS_SCREEN_QN = "branding:screen:branding-settings" as const;

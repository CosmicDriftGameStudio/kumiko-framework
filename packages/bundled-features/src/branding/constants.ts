export { BRANDING_FEATURE } from "./web/constants.ts";
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

// Keys under which managed-pages stored tenant branding before it moved into
// this feature. Stored rows stay under these names after the move; the new keys
// fall back to them when they have no row of their own.
export const LEGACY_BRANDING_QN = {
  title: "managed-pages:config:branding-title",
  description: "managed-pages:config:branding-description",
  siteUrl: "managed-pages:config:branding-site-url",
  accentColor: "managed-pages:config:branding-accent-color",
  logoUrl: "managed-pages:config:branding-logo-url",
  logoFile: "managed-pages:config:branding-logo-file",
  layoutPreset: "managed-pages:config:branding-layout-preset",
  customCss: "managed-pages:config:branding-custom-css",
} as const;

export const BRANDING_TOKENS_QUERY_QN = "branding:query:tokens" as const;
export const BRANDING_SETTINGS_SCREEN_QN = "branding:screen:branding-settings" as const;

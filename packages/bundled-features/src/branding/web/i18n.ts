// Pure data (i18n keys) under web/ so the web bundle may pivot it into the
// browser store; feature.ts (server) imports it as well.
//
// Translation bundle for the branding settings screen. Once a feature calls
// r.translations, the boot validator (required-surface-keys) demands the
// COMPLETE required-surface set; this file covers every screen/field/section
// key branding registers. The customCss keys are always supplied (harmless with
// allowCustomCss:false, but required for consumers that enable it).

type LocalizedString = { readonly en: string };

export const BRANDING_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:branding-settings.title": { en: "Branding" },

  // Config-Edit field labels (branding:entity:__config-edit__:field:*, camelCase form keys)
  "branding:entity:__config-edit__:field:title": { en: "Site title" },
  "branding:entity:__config-edit__:field:description": { en: "Description" },
  "branding:entity:__config-edit__:field:siteUrl": { en: "Site URL" },
  "branding:entity:__config-edit__:field:accentColor": { en: "Accent color" },
  "branding:entity:__config-edit__:field:logoUrl": { en: "Logo URL" },
  "branding:entity:__config-edit__:field:logoFile": { en: "Logo file" },
  "branding:entity:__config-edit__:field:layoutPreset": { en: "Layout" },
  "branding:section.identity": { en: "Identity" },

  // Only used when allowCustomCss:true in the screen; supplied unconditionally
  "branding:entity:__config-edit__:field:customCss": { en: "Custom CSS" },
  "branding:section.custom-css": { en: "Custom CSS" },
};

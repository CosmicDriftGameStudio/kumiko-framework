// Pure data (i18n keys) that lives under web/ so the web bundle may pivot it into
// the browser store; feature.ts (server) imports it as well (the server may import
// client-safe pure data, like PAT constants.ts).
//
// Translation bundle for the managed-pages admin screens. Without these keys the
// UI renders the raw i18n keys (screen:*.title, entity:*:field:*, section
// headers). Once a feature calls r.translations, the boot validator
// (required-surface-keys) demands the COMPLETE required-surface set in de+en;
// this file covers every screen/field/section key managed-pages registers. The
// two customCss keys are always supplied (harmless with allowCustomCss:false, but
// required for consumers that enable it).

type LocalizedString = { readonly en: string };

export const MANAGED_PAGES_I18N: Readonly<Record<string, LocalizedString>> = {
  // Screen titles (global/unprefixed, screenTitleKey = screen:<id>.title)
  "screen:page-list.title": { en: "Pages" },
  "screen:page-edit.title": { en: "Edit page" },
  "screen:branding-settings.title": { en: "Branding" },

  // Page-Entity Feld-Labels (managed-pages:entity:page:field:*)
  "managed-pages:entity:page:field:slug": { en: "Slug" },
  "managed-pages:entity:page:field:lang": { en: "Language" },
  "managed-pages:entity:page:field:title": { en: "Title" },
  "managed-pages:entity:page:field:published": { en: "Published" },
  "managed-pages:entity:page:field:published:option:true": {
    en: "Published",
  },
  "managed-pages:entity:page:field:published:option:false": { en: "Draft" },
  "managed-pages:entity:page:field:description": { en: "Description" },
  "managed-pages:entity:page:field:ogImage": { en: "OG image" },
  "managed-pages:entity:page:field:body": { en: "Content" },

  // Config-Edit Feld-Labels (managed-pages:entity:__config-edit__:field:*, camelCase Form-Keys)
  "managed-pages:entity:__config-edit__:field:title": { en: "Site title" },
  "managed-pages:entity:__config-edit__:field:description": {
    en: "Description",
  },
  "managed-pages:entity:__config-edit__:field:siteUrl": { en: "Site URL" },
  "managed-pages:entity:__config-edit__:field:accentColor": {
    en: "Accent color",
  },
  "managed-pages:entity:__config-edit__:field:logoUrl": { en: "Logo URL" },
  "managed-pages:entity:__config-edit__:field:logoFile": { en: "Logo file" },
  "managed-pages:entity:__config-edit__:field:layoutPreset": { en: "Layout" },

  // Section-Header
  "managed-pages:section.meta": { en: "Metadata" },
  "managed-pages:section.body": { en: "Content" },
  "managed-pages:branding.section.identity": { en: "Identity" },

  // Row-Actions + Confirm (pageListScreen)
  "managed-pages:actions.edit": { en: "Edit" },
  "managed-pages:actions.delete": { en: "Delete" },
  "managed-pages:confirms.page-delete": {
    en: "Delete this page?",
  },

  // Nur bei allowCustomCss:true im Screen — unconditional geliefert
  "managed-pages:entity:__config-edit__:field:customCss": { en: "Custom CSS" },
  "managed-pages:branding.section.custom-css": { en: "Custom CSS" },
};

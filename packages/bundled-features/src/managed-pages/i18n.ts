// @runtime client
// Pure-Data (i18n-Keys) — client-marked, damit das web/-Bundle sie in den
// Browser-Store pivotieren darf; feature.ts (server) importiert sie ebenso
// (server darf client-safe Pure-Data importieren, wie PAT constants.ts).
//
// Übersetzungs-Bundle für die managed-pages Admin-Screens. Ohne diese Keys
// rendert die UI die Roh-i18n-Keys (screen:*.title, entity:*:field:*, Section-
// Header). Der Boot-Validator (required-surface-keys) verlangt — sobald ein
// Feature r.translations ruft — den KOMPLETTEN Required-Surface-Satz in de+en;
// diese Datei deckt jeden Screen/Feld/Section-Key ab, den managed-pages
// registriert. Die zwei customCss-Keys werden unconditional geliefert (schaden
// bei allowCustomCss:false nicht, sind aber Pflicht für Consumer die es aktivieren).

type LocalizedString = { readonly en: string };

export const MANAGED_PAGES_I18N: Readonly<Record<string, LocalizedString>> = {
  // Screen-Titel (global/unpräfixiert — screenTitleKey = screen:<id>.title)
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

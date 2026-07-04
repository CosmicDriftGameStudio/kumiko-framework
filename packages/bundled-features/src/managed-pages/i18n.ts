// Übersetzungs-Bundle für die managed-pages Admin-Screens. Ohne diese Keys
// rendert die UI die Roh-i18n-Keys (screen:*.title, entity:*:field:*, Section-
// Header). Der Boot-Validator (required-surface-keys) verlangt — sobald ein
// Feature r.translations ruft — den KOMPLETTEN Required-Surface-Satz in de+en;
// diese Datei deckt jeden Screen/Feld/Section-Key ab, den managed-pages
// registriert. Die zwei customCss-Keys werden unconditional geliefert (schaden
// bei allowCustomCss:false nicht, sind aber Pflicht für Consumer die es aktivieren).

type LocalizedString = { readonly de: string; readonly en: string };

export const MANAGED_PAGES_I18N: Readonly<Record<string, LocalizedString>> = {
  // Screen-Titel (global/unpräfixiert — screenTitleKey = screen:<id>.title)
  "screen:page-list.title": { de: "Seiten", en: "Pages" },
  "screen:page-edit.title": { de: "Seite bearbeiten", en: "Edit page" },
  "screen:branding-settings.title": { de: "Branding", en: "Branding" },

  // Page-Entity Feld-Labels (managed-pages:entity:page:field:*)
  "managed-pages:entity:page:field:slug": { de: "Slug", en: "Slug" },
  "managed-pages:entity:page:field:lang": { de: "Sprache", en: "Language" },
  "managed-pages:entity:page:field:title": { de: "Titel", en: "Title" },
  "managed-pages:entity:page:field:published": { de: "Veröffentlicht", en: "Published" },
  "managed-pages:entity:page:field:description": { de: "Beschreibung", en: "Description" },
  "managed-pages:entity:page:field:ogImage": { de: "OG-Bild", en: "OG image" },
  "managed-pages:entity:page:field:body": { de: "Inhalt", en: "Content" },

  // Config-Edit Feld-Labels (managed-pages:entity:__config-edit__:field:*, camelCase Form-Keys)
  "managed-pages:entity:__config-edit__:field:title": { de: "Website-Titel", en: "Site title" },
  "managed-pages:entity:__config-edit__:field:description": {
    de: "Beschreibung",
    en: "Description",
  },
  "managed-pages:entity:__config-edit__:field:siteUrl": { de: "Website-URL", en: "Site URL" },
  "managed-pages:entity:__config-edit__:field:accentColor": {
    de: "Akzentfarbe",
    en: "Accent color",
  },
  "managed-pages:entity:__config-edit__:field:logoUrl": { de: "Logo-URL", en: "Logo URL" },
  "managed-pages:entity:__config-edit__:field:layoutPreset": { de: "Layout", en: "Layout" },

  // Section-Header
  "managed-pages:section.meta": { de: "Metadaten", en: "Metadata" },
  "managed-pages:section.body": { de: "Inhalt", en: "Content" },
  "managed-pages:branding.section.identity": { de: "Identität", en: "Identity" },

  // Row-Actions + Confirm (pageListScreen)
  "managed-pages:actions.edit": { de: "Bearbeiten", en: "Edit" },
  "managed-pages:actions.delete": { de: "Löschen", en: "Delete" },
  "managed-pages:confirms.page-delete": {
    de: "Diese Seite wirklich löschen?",
    en: "Delete this page?",
  },

  // Nur bei allowCustomCss:true im Screen — unconditional geliefert
  "managed-pages:entity:__config-edit__:field:customCss": { de: "Eigenes CSS", en: "Custom CSS" },
  "managed-pages:branding.section.custom-css": { de: "Eigenes CSS", en: "Custom CSS" },
};

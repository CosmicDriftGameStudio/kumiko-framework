// Pure data (i18n keys) that lives under web/ so the web bundle may pivot it into
// the browser store; feature.ts (server) imports it as well (the server may import
// client-safe pure data, like PAT constants.ts).
//
// Translation bundle for the managed-pages admin screens. Without these keys the
// UI renders the raw i18n keys (screen:*.title, entity:*:field:*, section
// headers). Once a feature calls r.translations, the boot validator
// (required-surface-keys) demands the COMPLETE required-surface set in de+en;
// this file covers every screen/field/section key managed-pages registers.
// Branding labels live in the branding feature.

type LocalizedString = { readonly en: string };

export const MANAGED_PAGES_I18N: Readonly<Record<string, LocalizedString>> = {
  // Screen titles (global/unprefixed, screenTitleKey = screen:<id>.title)
  "screen:page-list.title": { en: "Pages" },
  "screen:page-edit.title": { en: "Edit page" },
  "screen:page-edit.createTitle": { en: "New page" },

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

  // Page workbench
  "managed-pages:editor.noValue": { en: "Not set" },
  "managed-pages:editor.infoEdit": {
    en: "Edit the page on the left; the right side holds its address and settings.",
  },
  "managed-pages:editor.infoPreview": {
    en: "Preview of the unsaved draft, as visitors will see it.",
  },
  "managed-pages:editor.railPage": { en: "Page" },
  "managed-pages:editor.create": { en: "Create page" },
  "managed-pages:editor.loadFailed": { en: "The page could not be loaded." },

  // Document body: write-time rejection and the Markdown conversion warning
  "managed-pages.errors.document.rejected": {
    en: "The content contains elements that are not allowed: {detail}",
  },
  "managed-pages:body.lossy.warning": {
    en: "This page was written in Markdown. Converting it to the editor drops: {features}. Check the result before saving.",
  },
  "managed-pages:body.lossy.image": { en: "external images" },
  "managed-pages:body.lossy.blockquote": { en: "block quotes" },
  "managed-pages:body.lossy.code": { en: "code" },
  "managed-pages:body.lossy.deepHeading": { en: "headings below level 3" },

  // Row-Actions + Confirm (pageListScreen)
  "managed-pages:actions.edit": { en: "Edit" },
  "managed-pages:actions.delete": { en: "Delete" },
  "managed-pages:confirms.page-delete": {
    en: "Delete this page?",
  },
};

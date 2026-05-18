// @runtime client
// Feature name
export const LEGAL_PAGES_FEATURE = "legal-pages" as const;

// Required slugs that must exist as text-blocks for production-boot.
// Pro Sprache + Slug eine Pflicht-Kombo. Wer mehr Sprachen will, ergänzt
// die Liste — Boot-Check wird dynamisch aus der Liste generiert.
export const LEGAL_REQUIRED_BLOCKS = [
  { slug: "imprint", lang: "de" },
  { slug: "privacy", lang: "de" },
] as const;

// Optionale Blocks die NICHT Boot-fail-relevant sind, aber die Routes
// servieren falls vorhanden. EN-Versionen sind in DACH-Apps oft nur
// "nice-to-have".
export const LEGAL_OPTIONAL_BLOCKS = [
  { slug: "imprint", lang: "en" },
  { slug: "privacy", lang: "en" },
] as const;

// Public-Route-Mapping: URL-Path → (slug, lang). DE nutzt die deutschen
// Standard-Bezeichnungen, EN die englischen.
export const LEGAL_ROUTES = [
  { path: "/legal/impressum", slug: "imprint", lang: "de", titleFallback: "Impressum" },
  {
    path: "/legal/datenschutz",
    slug: "privacy",
    lang: "de",
    titleFallback: "Datenschutzerklärung",
  },
  { path: "/legal/imprint", slug: "imprint", lang: "en", titleFallback: "Imprint" },
  { path: "/legal/privacy", slug: "privacy", lang: "en", titleFallback: "Privacy Policy" },
] as const;

export const LegalPagesErrors = {
  bootMissingBlock: "legal_pages_boot_missing_block",
} as const;

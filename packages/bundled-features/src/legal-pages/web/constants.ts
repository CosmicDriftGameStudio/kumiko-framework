// Feature name
export const LEGAL_PAGES_FEATURE = "legal-pages" as const;

// Shape of one public route entry — the type behind LEGAL_ROUTES, exported
// so non-DACH apps can type their own `routes` option (e.g. a Spanish-
// default app with an additional AGB/terms page).
export type LegalPageRoute = {
  readonly path: string;
  readonly slug: string;
  readonly lang: string;
  readonly titleFallback: string;
  /** Prepend the page title as `<h1>` to the rendered body. Default false. */
  readonly titleHeading?: boolean;
};

// Shape of one boot-check-required block — the type behind
// LEGAL_REQUIRED_BLOCKS, exported for the same reason as LegalPageRoute.
export type LegalRequiredBlock = {
  readonly slug: string;
  readonly lang: string;
};

// Required slugs that must exist as text-blocks for production-boot.
// One mandatory slug per language; anyone who wants more languages extends
// the list, the boot check is generated dynamically from it.
export const LEGAL_REQUIRED_BLOCKS = [
  { slug: "imprint", lang: "de" },
  { slug: "privacy", lang: "de" },
] as const;

// Optional blocks that are NOT boot-fail relevant, but whose routes are
// served when present. EN versions are often only nice-to-have in DACH apps.
export const LEGAL_OPTIONAL_BLOCKS = [
  { slug: "imprint", lang: "en" },
  { slug: "privacy", lang: "en" },
] as const;

// Public route mapping: URL path -> (slug, lang). DE uses the German
// standard names, EN the English ones.
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

// Terms of service are opt-in (`terms: true`) and never boot-required: not every
// app needs them, and DACH law does not mandate them the way it does imprint.
export const LEGAL_TERMS_ROUTES = [
  {
    path: "/legal/nutzungsbedingungen",
    slug: "terms",
    lang: "de",
    titleFallback: "Nutzungsbedingungen",
  },
  { path: "/legal/terms", slug: "terms", lang: "en", titleFallback: "Terms of Service" },
] as const;

// Client-safe path lookup so apps that render their own legal pages (e.g. a
// static marketing site) link to the same paths the feature serves.
export function legalPagePath(
  routes: readonly LegalPageRoute[],
  slug: string,
  lang: string,
): string | undefined {
  return routes.find((route) => route.slug === slug && route.lang === lang)?.path;
}

export const LegalPagesErrors = {
  bootMissingBlock: "legal_pages_boot_missing_block",
} as const;

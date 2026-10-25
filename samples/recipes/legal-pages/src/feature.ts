// Legal-pages sample
//
// DACH apps (DE/AT/CH) are required to make an imprint (TMG/DDG §5) and
// a privacy policy (GDPR Art. 13) publicly accessible.
// That is 1) identical for every app and 2) annoying to build
// by hand per app.
//
// Solution: combine two opt-in bundled features:
//
//  - `template-resolver` — the content store (entity `template-resource`,
//    kind `text-block` with slug+locale+title+content, scoped per tenant).
//    Also usable for FAQ, About, ToS, marketing snippets — not
//    legal-specific.
//
//  - `legal-pages`   — opt-in wrapper on top of it that registers four fixed public
//    routes (`/legal/impressum`, `/legal/datenschutz`, `/legal/imprint`,
//    `/legal/privacy`) and renders Markdown→HTML. Plus a
//    boot check that fails hard in production when the DE required blocks
//    are missing.
//
// Tenant model: 1 app = X tenants = 1 imprint. All subdomains
// share the SYSTEM_TENANT_ID version. If you need per-tenant imprints,
// you have to put your own routing in front or use the by-slug
// query with a tenant-specific tenantId.
//
// Prerequisites for production:
//  - `anonymousAccess` must be configured in runProdApp/runDevApp
//    (defaultTenantId = SYSTEM_TENANT_ID), otherwise the
//    legal-pages routes answer with 503
//  - `extraContext.templateResolver = createTemplateResolverApi(db, registry)` must be
//    wired, otherwise the boot check throws with a wiring hint
//  - On first boot the TextBlocks must be seeded —
//    template-resolver/seeding `seedTextBlock` or via API
//    `template-resolver:write:set` with a TenantAdmin token

import {
  createLegalPagesFeature,
  createLegalPagesLayout,
  LEGAL_REQUIRED_BLOCKS,
  LEGAL_ROUTES,
  LEGAL_TERMS_ROUTES,
} from "@cosmicdrift/kumiko-bundled-features/legal-pages";
import { createTemplateResolverFeature } from "@cosmicdrift/kumiko-bundled-features/template-resolver";

// Beide Features aktivieren — template-resolver ist Foundation, legal-pages
// requires sie. r.requires({ features: ["template-resolver"] }) greift automatisch im
// legal-pages-Feature.
export const templateResolverFeature = createTemplateResolverFeature();
// `terms: true` adds the opt-in terms routes; the layout puts the app's chrome
// around every legal page.
export const legalPagesFeature = createLegalPagesFeature({
  terms: true,
  wrapLayout: createLegalPagesLayout({
    siteName: "Sample App",
    footerHtml: (lang) =>
      lang === "de" ? "<footer>Sample App</footer>" : "<footer>Sample App (en)</footer>",
  }),
});

// Re-exports for tests + other demos
export { LEGAL_REQUIRED_BLOCKS, LEGAL_ROUTES, LEGAL_TERMS_ROUTES };

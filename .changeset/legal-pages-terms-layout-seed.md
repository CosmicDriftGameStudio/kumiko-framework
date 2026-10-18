---
"@cosmicdrift/kumiko-bundled-features": minor
---

legal-pages: terms routes, layout helper and boot seed

<!-- kumiko-changes
feature: legal-pages
type: improvement
title: legal-pages serves terms of service, ships a layout helper and a boot seed
detail: createLegalPagesFeature({ terms: true }) adds /legal/nutzungsbedingungen and /legal/terms (slug terms, de/en, never boot-required). createLegalPagesLayout({ siteName, css?, stylesheetHrefs?, headerHtml?, footerHtml?, contentClass? }) builds a wrapLayout with the app's chrome. legalContentSeed({ blocks } | { path }) returns a seed for runProdApp seeds that writes the blocks into SYSTEM_TENANT and updates existing ones, so the JSON stays authoritative. legalPagePath(routes, slug, lang) from the client-safe ./legal-pages/constants subpath gives static sites the same paths. Defaults are unchanged.
-->

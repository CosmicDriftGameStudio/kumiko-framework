---
"@cosmicdrift/kumiko-headless": minor
---

Add `@cosmicdrift/kumiko-headless/apex` — a server-side renderer for static
marketing landings (`renderApexPage(page: ApexPage): string`).

Apps that hand-rolled near-identical bespoke landings can now describe the page
as typed data (hero / feature-grid / pricing-grid / info-grid / final-cta /
header / footer) and let the framework emit one cacheable HTML string. The
shared structure, grids, cards and responsive breakpoints live in the package;
the app passes only its brand tokens (`brand.tokensCss` / `brand.fontFaceCss`)
and content. Zero React, one HTTP response.

Two themes ship together; `theme: "light" | "dark"` toggles a `<body class>`.
Token divergence between apps is absorbed by CSS fallbacks (`var(--font-mono,
inherit)`, `color-mix` icon tint, `--footer-cols`, `--hero-tagline-max`), not by
extra parameters. `ApexHead.alternates` emits `hreflang` links for multilingual
SEO. User-provided text is escaped; app-authored `metaHtml` / feature `icon`
markup is passed through verbatim (documented trust boundary).

Additive: a new subpath export, no change to existing entry points.

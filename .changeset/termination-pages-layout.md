---
"@cosmicdrift/kumiko-bundled-features": minor
---

`createContractTerminationRoutes` accepts a `wrapLayout`, the same function `createLegalPagesFeature` takes. It wraps every termination page (form, review, result, 429, error); the security headers stay with the framework. The layout also receives `alternates`, a map from locale to the path of the same page, so it can render a language switch from plain links. `page-render` exports the shared type `PublicPageWrapLayout`; `LegalPagesWrapLayout` is now an alias of it. The page body sits in `<div data-kumiko-page="contract-termination">` with `data-kumiko-*` hooks on the form, field groups, buttons and review table. The page CSP keeps `script-src 'none'`, so a layout must not rely on JavaScript.

The default `wrapInLayout` stylesheet gains base rules for input, select, textarea and button, so unstyled forms stay readable.

The termination pages and every legal page now answer the other trailing-slash form of their path (`/legal/kuendigen/`, `/legal/impressum/`) with a 301 to the configured path for GET and HEAD, query string kept. POST has no alias.

The termination receipt mail text changed: it now starts with a greeting line ("Hallo," / "Hello,") and the English sentence starts capitalized ("We confirm receipt ..."). The receipt content still depends only on the declarant's input.

<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: App layout around termination pages, trailing-slash redirects, receipt greeting
-->

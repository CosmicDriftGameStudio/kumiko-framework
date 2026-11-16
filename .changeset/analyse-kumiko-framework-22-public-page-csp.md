---
"@cosmicdrift/kumiko-bundled-features": minor
---

Public server-rendered pages send a closed Content-Security-Policy with default-src 'none'.

<!-- kumiko-changes
feature: page-render
type: breaking
title: Public pages send default-src 'none' and form-action 'none'
detail: securePageHeaders (legal-pages, managed-pages, seo pages, contract termination) now sends "default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; font-src 'self'; form-action 'none'; frame-ancestors 'self'". Images may come from the own origin, https or data URLs; stylesheets and fonts only from the own origin; forms post nowhere. An optional second argument relaxes form-action or frame-ancestors; the contract termination pages use it for form-action 'self' and frame-ancestors 'none'.
migration: Layouts passed as wrapLayout or stylesheetHrefs must load stylesheets and fonts from the app's own origin and must not post forms; serve such assets under the app host instead of a foreign host.
-->

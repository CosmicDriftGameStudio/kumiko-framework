---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer-mail-html": patch
"@cosmicdrift/kumiko-renderer-puppeteer-client": patch
---

Mail rendering, PDF rendering and the PDF preview resolve layouts through one shared rule for re-checking tenant layouts.

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: One trusted layout resolution for mail, PDF and preview
detail: `resolveTrustedLayout(api, request, alreadyResolved?)` from the template-resolver entry point resolves a mail or PDF layout and re-checks a tenant row on every render: a tenant layout that is not html or fails the layout sanitizer is replaced by the system layout of the same slug, a passing one is returned with its sanitized content. Mail rendering, PDF rendering and the PDF preview each kept their own copy of this rule; they now share it. A leftover non-html tenant pdf-layout row now falls back to the system layout like a mail layout does. `TemplateNotFoundError` still reaches the caller, which keeps its own fallback.
-->

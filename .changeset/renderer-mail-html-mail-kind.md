---
"@cosmicdrift/kumiko-renderer-mail-html": minor
---

renderer-mail-html renders kind mail from document templates; the Markdown path is removed

<!-- kumiko-changes
feature: renderer-mail-html
type: breaking
title: renders kind mail from document templates, Markdown path removed
detail: The plugin serves kind mail. It resolves the template by slug (contentFormat html, meta.subject required), compiles the document body to Handlebars through template-resolver, renders it in an isolated Handlebars instance (helpers money, date and link, HTML escaping on) and places the result into the mail-layout named by meta.layoutSlug (default slug default, in-code DEFAULT_MAIL_LAYOUT_MJML as fallback). The layout only sees content, subject, previewText, tenantName, signature, imprint and unsubscribeUrl. The response carries subject and previewText; the subject has line breaks removed. Markdown rendering and the content/contentFormat payload are gone; DEFAULT_MAIL_LAYOUT_MJML uses tenantName instead of appName. seedSystemMailLayout writes kind mail-layout slug default through seedSystemTemplate and is idempotent. New dependency on @cosmicdrift/kumiko-headless.
migration: |
  Send kind mail requests with { slug, locale, variables } and move mail texts into kind mail templates (html body plus meta.subject), for example through r.notification({ template, meta }). Custom mail layouts become kind mail-layout, contentFormat mjml, slug default and use {{tenantName}} instead of {{appName}}; the body is inserted with {{{content}}}.
-->

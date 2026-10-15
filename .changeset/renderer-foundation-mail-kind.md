---
"@cosmicdrift/kumiko-bundled-features": minor
---

renderer-foundation renders kind mail instead of mail-html

<!-- kumiko-changes
feature: renderer-foundation
type: breaking
title: RenderRequest kind mail replaces mail-html
detail: RenderRequest and RenderResponse use kind mail with a MailPayload ({ slug, locale, variables, unsubscribeUrl? }) and a response of { subject, html, text, previewText? }. The default plugin name for kind mail stays mail-html. RendererContext gains an optional config accessor that plugins use for tenant locale, currency and branding.
migration: |
  Replace kind mail-html with mail in createRendererForTenant and render calls, pass { slug, locale, variables } instead of content/contentFormat, and read the subject from the response instead of building it yourself. Pass ctx.config in the RendererContext to get tenant locale, currency and branding.
-->

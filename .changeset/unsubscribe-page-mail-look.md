---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer-mail-html": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
---

Unsubscribe pages wear the tenant's mail look

<!-- kumiko-changes
feature: delivery
type: improvement
title: Unsubscribe confirmation, result and link-invalid pages look like the tenant's mails
detail: The pages behind a mail's unsubscribe link now show the tenant's brand row (logo from managed-pages branding or the initial tile, name, brand suffix), the accent color, the site band and the mail footer (footer text, imprint, privacy) in a centered card with the bundled IBM Plex Sans font served same-origin, no external font CDN. Every state (confirm, unsubscribed with undo, subscribed again, failed, link invalid or expired) is translated in en, de and es and fits 375 px. The page answers with its own CSP (default-src 'none', the style block by sha256 hash, font-src 'self', img-src 'self' data: plus the logo's https origin, form-action 'self'). A browser GET or form POST with an invalid or expired token now gets a 400 HTML page instead of JSON (expired tokens keep the tenant's look and the mail's language, forged ones get the plain page in the Accept-Language language); JSON and one-click requests answer as before. Mail renderers can implement the new optional RendererPlugin.readMailChrome (renderer-mail-html does) which the system-only query delivery:query:unsubscribePageChrome reads. renderUnsubscribeResultPage takes an optional chrome; apps with their own CSP need style-src 'unsafe-inline' and the logo origin for it.
-->

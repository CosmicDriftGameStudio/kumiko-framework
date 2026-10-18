---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-document-designer": minor
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
---

Mail editor: informal German, tenant sender hint, readable button chips

<!-- kumiko-changes
feature: document-designer
type: fix
title: Designer addresses the user informally in German, points tenant-routed senders to Email sending and renders chips inside buttons
detail: All German document designer strings use du like the rest of the framework; the formal locale overrides keep Sie. For a notification with tenantTransport the sender hint in the mail editor says the address comes from the tenant's Email sending settings and links to that screen when the app mounts it; TemplateUsageEntry gains tenantTransport. A placeholder chip inside a button block is now drawn in inverted colors so the button text stays readable in the editor.
-->

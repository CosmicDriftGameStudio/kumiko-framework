---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer": patch
---

Inbound mail keeps a sanitized HTML body next to the plain text, so the inbox can show the mail as it was formatted.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: Sanitized HTML body on inbound messages (message.bodyHtml, event version 4)
detail: ingest-message and attach-message-content run the HTML part of a mail through sanitizeInboundHtml (sanitize-html allowlist for tags, attributes, schemes and style properties; no scripts, forms, on* attributes, cid: or data: images; links open in a new tab with rel="noopener noreferrer"; empty or over 500,000 characters becomes null instead of a cut-off body). Only the sanitized result reaches the event and the projection, PII-encrypted for the tenant like bodyText; the unsanitized original stays in file storage. inbound-message-received and inbound-message-content-fetched are version 4 with bodyHtml (older events upcast to null), the entity message has the new field bodyHtml, and message:content returns bodyHtml (string or null).
migration: Run `kumiko-schema generate <name>` in each app that mounts inbound-mail-foundation to get the migration for the new column read_inbound_messages.body_html. Existing messages keep bodyHtml null and show their plain text; nothing else to do.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: HtmlMailFrame renders mail HTML in a fully sandboxed frame with a fixed height
detail: The iframe of MessageThread and MessageReader no longer sets allow-same-origin, so mail HTML runs with an opaque origin and no script access (sandbox allows only popups for links). Without same-origin the parent cannot measure the content, so the frame has a fixed height of 32rem and scrolls itself. The CSP of the frame allows data: images always and http(s) images only after the reader asks.
-->

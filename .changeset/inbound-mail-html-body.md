---
"@cosmicdrift/kumiko-bundled-features": minor
---

Inbound mail keeps a sanitized HTML body next to the plain text, so the inbox can show the mail as it was formatted.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: Sanitized HTML body on inbound messages (message.bodyHtml, event version 4)
detail: ingest-message and attach-message-content run the HTML part of a mail through sanitizeInboundHtml (sanitize-html allowlist for tags, attributes, schemes and style properties; no scripts, forms, on* attributes, cid: or data: images; img src only absolute http(s), a href only absolute http(s), mailto or tel, so nothing resolves against the app origin; links open in a new tab with rel="noopener noreferrer"; empty or over 500,000 characters becomes null instead of a cut-off body). Only the sanitized result reaches the event and the projection, PII-encrypted for the tenant like bodyText; the unsanitized original stays in file storage. inbound-message-received and inbound-message-content-fetched are version 4 with bodyHtml (older events upcast to null), the entity message has the new field bodyHtml, and message:content returns bodyHtml (string or null).
migration: Run `kumiko-schema generate <name>` in each app that mounts inbound-mail-foundation to get the migration for the new column read_inbound_messages.body_html. Existing messages keep bodyHtml null and show their plain text; nothing else to do.
-->

---
"@cosmicdrift/kumiko-bundled-features": minor
---

Consumer protection mails are template notifications

<!-- kumiko-changes
feature: billing-foundation
type: breaking
title: Contract confirmation and termination mails use template variables
detail: contract-confirmation, contract-termination-receipt and contract-termination-operator-notice are r.notification declarations with variables and localized templates (de, en). The notification types are qualified names now (billing-foundation:notify:<name>). The notify data is the template variable object (subject, details, contractLines, termsParagraphs, operatorEmail), not sections.
migration: |
  Update delivery preferences and tests that referenced the old type strings, and anything that listens to the notification data. An app that mounts it without includeBundled needs template-resolver, renderer-foundation and @cosmicdrift/kumiko-renderer-mail-html at boot (composeRendererStack() from dev-server mounts all of them), plus a delivery with the channel-email feature; apps without the template tables need a schema migration (`kumiko schema generate`).
-->

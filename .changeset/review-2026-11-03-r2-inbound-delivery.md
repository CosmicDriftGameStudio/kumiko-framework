---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Inbound mail and delivery hardening: content reload scans past the newest 1000 mails, IMAP downloads are cut at a byte budget, an abandoned sync stops ingesting, connection-refused mail sends are retried, and operator transitions of event consumers leave an audit event.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: fix
title: inbound mail content reload, IMAP download budget, abandoned syncs, mail retry, consumer audit
detail: The snippet-only content reload remembers per account where its scan stopped, so mails behind the newest 1000 anchors are reloaded over later ticks. The IMAP provider reads message sizes first, reports mails above the 50 MB limit as rejected without downloading them, and cuts each download at 100 MB (the rest follows in the next round via hasMore). A sync abandoned at its deadline stops ingesting before the next message. A mail adapter that throws ECONNREFUSED, ENOTFOUND, EAI_AGAIN, EHOSTUNREACH or ENETUNREACH is retried, since nothing was accepted. The jobs consumer-restart, -skip, -disable and -enable writes append a `jobs:event:consumer-state-changed` event (action, consumer, skipped event id, actor) that the audit log shows; locale packages gain the label `audit.log.event.consumer-state-changed`. `sendMailFromAccount` documents that it cannot be rolled back.
-->

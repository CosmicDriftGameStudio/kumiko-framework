---
"@cosmicdrift/kumiko-bundled-features": minor
---

A mailbox send key now belongs to the caller and the mailbox, so another user's key neither answers nor blocks a send.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: breaking
title: Send idempotency keys bound to caller and mailbox
detail: sendMailFromAccount checks the mailbox and the caller's send right before it looks up an idempotencyKey. The stored send record carries the caller's userId, and a key matches only for the same user and mailbox. Before, a key recorded for another mailbox returned that send's Message-ID or outcomeUnknown to anyone in the tenant.
migration: Regenerate the schema (kumiko schema generate). store_mail_outbound_sends gets a nullable user_id column, and its unique index becomes (tenant_id, user_id, account_id, idempotency_key). Records written before the update have no user and no longer dedupe a retry.
affects: sendMailFromAccount, outboundMailSendEntity
-->

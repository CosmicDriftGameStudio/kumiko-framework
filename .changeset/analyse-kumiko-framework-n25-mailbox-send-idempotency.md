---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-it": patch
---

sendMailFromAccount takes an idempotencyKey.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: breaking
title: Idempotent send from a mailbox
detail: `sendMailFromAccount(ctx, { accountId, message, idempotencyKey })` records each keyed send in the new store table `store_mail_outbound_sends` through `ctx.db.outsideTransaction`. After a successful send, a repeat with the same key returns the stored `messageIdHeader` and `attachmentFileIds` without sending again. If a send started under the key but never finished (crash, parallel call), the key answers with the typed failure `mail_send_outcome_unknown` instead of sending a second copy. A typed send failure frees the key for a retry. Without a key the function behaves as before.
migration: Run `kumiko schema generate` and apply the migration for `store_mail_outbound_sends`. Pass a stable key from a job that dispatches the sending write, for example the id of the event that asked for the mail.
affects: inbound-mail-foundation, sendMailFromAccount
-->

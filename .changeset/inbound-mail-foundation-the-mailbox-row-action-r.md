---
"@cosmicdrift/kumiko-bundled-features": minor
---

The mailbox row action Reconnect is folded into Reactivate

The row action reconnect of mailAccountListScreen and its i18n key inboundMail.accounts.reconnect are removed. A password IMAP mailbox with a sign-in error now shows Reactivate, which opens the same screen mail-account-reconnect-imap; OAuth mailboxes get the client action reactivate-oauth instead.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: breaking
title: The mailbox row action Reconnect is folded into Reactivate
migration: |
  Apps that override inboundMail.accounts.reconnect move the text to inboundMail.accounts.reactivate. Apps that reference the row action id reconnect (tests, screen extensions) use reactivate for password IMAP and reactivate-oauth for OAuth mailboxes, and mount inboundMailFoundationClient() from @cosmicdrift/kumiko-bundled-features/inbound-mail-foundation/web so the OAuth action runs.
-->

---
"@cosmicdrift/kumiko-bundled-features": minor
---

The OAuth callback only connects the mailbox of the account that signed in

InboundOAuthFlow.exchangeCode returns OAuthCodeExchange, an OAuthTokenSet with the required accountAddress of the signed-in provider account. The callback compares it with the mailbox address, ignoring case, and answers 403 mailbox_address_mismatch with a plain-text message and no account when they differ, so nobody can claim another person's address.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: breaking
title: The OAuth callback only connects the mailbox of the account that signed in
migration: |
  Inbound providers with an oauth block return accountAddress from exchangeCode, taken from the token's email claim or the provider's profile endpoint (for example the userinfo email). There is no default: a provider that cannot name the signed-in address cannot connect mailboxes.
-->

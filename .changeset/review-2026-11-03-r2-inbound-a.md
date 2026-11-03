---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

IMAP mailbox connect and send: cross-tenant limit per target host, clearer send failures, one fetch-and-parse path, accurate TLS texts.

<!-- kumiko-changes
feature: inbound-provider-imap
type: fix
title: IMAP connect limited per target host, send failures classified correctly, watch and poll share one fetch path
detail: The connect, connect-my and reconnect checks now also count per target host and per host plus user across all tenants (200 and 20 per 10 minutes), so many tenants cannot probe one foreign mail server. Sending reports "not set up" when the credential document is missing or unreadable, and for a failed certificate check or a blocked host, instead of a rejected password or a retryable outage. Poll, watch and content refetch fetch and parse mails through one function. The TLS failure text no longer mentions a TLS setting the form does not have, and the SMTP port hint states that 465 means SSL/TLS and every other port STARTTLS. attach-message-content fails instead of treating a stream without a readable received event as a shared mailbox.
-->

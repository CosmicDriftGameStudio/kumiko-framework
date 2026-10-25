---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

The "Connect mailbox" form has a required SMTP port field, preset to 587. New mailboxes send over 587 with STARTTLS instead of a fixed port 465, because many hosters (for example Hetzner) block outgoing 465.

<!-- kumiko-changes
feature: inbound-provider-imap
type: fix
title: Mailboxes connect and send over SMTP port 587 with STARTTLS
detail: The connect form gets a required field "SMTP port", preset to 587, and stores it as smtpPort in the credential document (the schema still accepts any stored port, default now 587). Port 465 uses implicit TLS; every other port uses STARTTLS with requireTLS, so the password is never sent in clear text and the connection fails when the server offers no STARTTLS. The certificate is checked against the host name on the STARTTLS upgrade as well. The SMTP failure texts name the entered port. New key for the field label in all locale packages.
-->

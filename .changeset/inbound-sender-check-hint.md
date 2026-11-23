---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

The sender check hint says the mail server ID belongs only to a server that stamps every incoming mail.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: fix
title: Sender check hint names the precondition for a trusted mail server ID
detail: The hint on the sender check field and the inbound mail guide now say to enter the authserv-id only when that server adds an Authentication-Results header to every incoming mail. Otherwise a forged topmost header counts as checked. No behaviour changes.
-->

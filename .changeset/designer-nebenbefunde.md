---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-document-designer": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-mail-html": patch
"@cosmicdrift/kumiko-renderer-puppeteer-client": patch
---

Billing confirmation and termination receipt mails reach users again when PII encryption is active. The tests of the designer and renderer packages are now part of the root type check, and a DOM test no longer types into a form before its effects have run.

<!-- kumiko-changes
feature: billing-foundation
type: fix
title: Contract mails reach users with encrypted email addresses
detail: With a KMS configured, the contract confirmation and the receipt for a termination from the user account used the stored, encrypted email address as recipient. The mail channel refuses such addresses, so neither mail was sent and the send job failed after its retries. Both now decrypt the address first; an erased user gets no mail, as before for deleted users.
-->

<!-- kumiko-changes
feature: document-designer
type: fix
title: Long template names wrap in the template overview
detail: In the template overview, a long template name such as "Kündigungshinweis an den Betreiber" now wraps to a second line instead of widening the first column. The overview fits at 1280 px again when billing-foundation templates are listed.
-->

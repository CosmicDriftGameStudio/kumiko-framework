---
"@cosmicdrift/kumiko-renderer-mail-html": patch
"@cosmicdrift/kumiko-renderer-puppeteer-client": patch
---

Mail footer, richText meta lines and PDF image conditions hardened.

<!-- kumiko-changes
feature: renderer-mail-html
type: fix
title: Mail footer cannot be dropped, richText in subject is plain text
detail: An mjml layout without the mailFooterHtml placeholder now gets the platform footer appended before the end of the body. Layout links to the imprint or unsubscribe URL only count when they sit in the header, signature or footer region and have link text. richText variables in subject, preview and other meta lines render as plain text instead of raw HTML. An invalid tenant time zone is logged as a warning.
-->

<!-- kumiko-changes
feature: renderer-puppeteer-client
type: fix
title: Conditions on images variables work in the PDF render
detail: A data-condition on an images variable now shows its block when the record has resolvable images, instead of never. Record image loading stops once the byte budget is used up, caps the number of looked-up ids, and ignores image blocks whose variable is not declared as images.
-->

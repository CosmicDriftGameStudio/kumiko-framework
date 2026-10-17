---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-document-designer": patch
---

The layout editor counts the users of a layout on the server instead of from a page of 200 templates

<!-- kumiko-changes
feature: template-resolver
type: fix
title: template-resolver:query:overview accepts layoutSlug to list only the mails and PDFs using that layout
detail: The optional layoutSlug payload field keeps only documents whose layout slug matches; total counts the filtered rows. Without it the response is unchanged.
-->

<!-- kumiko-changes
feature: document-designer
type: fix
title: Layout editor shows the real number of mails or PDFs using a layout
detail: The editor asks the overview for the users of one layout (kind and layoutSlug filter) and takes the count from total, so a tenant with more than 200 templates no longer sees a too low usage number.
-->

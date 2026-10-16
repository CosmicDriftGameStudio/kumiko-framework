---
"@cosmicdrift/kumiko-bundled-features": patch
---

Document editor offers the PDF block set in document-pdf collections and keeps placeholder links out of the text

<!-- kumiko-changes
feature: template-resolver
type: fix
title: PDF collections show Page break instead of Button, and placeholder links no longer insert {{name}} text
detail: The content editor for a `document-pdf` collection now offers the PDF block set (including Page break) instead of the mail set, chosen from the collection's kind. A link to a placeholder href such as `{{invoice.url}}` without a selection now links a variable node instead of inserting the placeholder as plain text.
-->

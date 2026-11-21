---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

A `document` field with `formatting: "text"` keeps a value that holds only an image, divider or table, and drops such blocks from pasted content.

<!-- kumiko-changes
feature: renderer
type: fix
title: Text-formatted document fields keep image-only values and filter pasted blocks
detail: A `document` field with `formatting: "text"` treated a value without text as empty, so a document holding only an image, divider or table was stored as "". Only a value without text and without such blocks is empty now. In the template-resolver editor, pasted images, dividers, buttons, page breaks and step blocks are dropped in text mode and pasted tables keep their cell text as paragraphs; blocks already in the stored value stay untouched.
-->

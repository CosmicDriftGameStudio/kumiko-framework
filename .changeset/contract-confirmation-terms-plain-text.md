---
"@cosmicdrift/kumiko-bundled-features": patch
---

Contract confirmation mail renders the terms as plain text

<!-- kumiko-changes
feature: billing-foundation
type: fix
title: Terms in the contract confirmation mail no longer show raw Markdown
detail: The terms Markdown is reduced to plain text rows: bold and italic markers are dropped, links become "label (url)", list items get their own row, and single line breaks inside a paragraph become spaces.
-->

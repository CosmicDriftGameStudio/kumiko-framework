---
"@cosmicdrift/kumiko-bundled-features": patch
---

The contract confirmation mail shows Markdown in the terms as formatting instead of literal markers

<!-- kumiko-changes
feature: billing-foundation
type: fix
title: Contract confirmation mail renders the terms' Markdown as formatting
detail: The terms rows of the contract confirmation mail were plain text, so `**Right to cancel.**` reached the buyer with its asterisks (0.363.0) or lost its emphasis. Each row of `termsParagraphs` is now a richText value: bold, italic and http(s)/mailto/tel links render as HTML, headings become bold rows. Author HTML and images in the terms stay escaped text, and links outside those schemes stay "label (url)". Tenant overrides of the template keep working, the variable name and row structure are unchanged.
-->

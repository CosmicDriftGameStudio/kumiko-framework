---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-cli": patch
---

The handbuch renderer uses the renderer's escapeHtmlAttr, and deriveKey shares its key split with the derivative helpers.

<!-- kumiko-changes
feature: cli
type: improvement
title: handbuch escapes HTML through the renderer helper
detail: The handbuch renderer uses escapeHtmlAttr from @cosmicdrift/kumiko-renderer/headless instead of its own copy. The escaped characters are the same as before, including the single quote.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: One key split for file variants and derivatives
detail: deriveKey and the derivative key helpers split a storage key into base and extension through the same function, so both always agree on where the extension starts. No behavior change.
-->

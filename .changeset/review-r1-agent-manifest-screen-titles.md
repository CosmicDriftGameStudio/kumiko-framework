---
"@cosmicdrift/kumiko-bundled-features": patch
---

Agent manifest screen titles no longer depend on feature mount order

Two features with a screen of the same short id used to get the title of whichever feature was mounted first. The manifest now looks up the screen's own feature-prefixed title key first and falls back to the unprefixed key.

<!-- kumiko-changes
feature: agent-tools
type: fix
title: Agent manifest screen titles resolve per feature instead of by mount order
-->

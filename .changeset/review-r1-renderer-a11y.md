---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

Tabs-mode section descriptions render again, Save stays disabled on an untouched projectionDetail with extensions, select radiogroups and tab triggers no longer reference missing elements

In `layout.mode: "tabs"` a fields section's `description` is shown as the card subtitle instead of being dropped. A projectionDetail without a fields section whose extension registers with the form host no longer shows an always-active Save. A select rendered as radio group outside a `Field` is named via `aria-label` instead of a dangling `aria-labelledby`, tab triggers drop the `aria-controls` that pointed at a tabpanel the strip never renders, and card-list meta items are pinned to one line height so the two-line clamp cuts between lines.

<!-- kumiko-changes
feature: renderer-web
type: fix
title: Tabs-mode section descriptions, disabled Save on untouched projectionDetail extensions and radiogroup/tab ARIA references are fixed
-->

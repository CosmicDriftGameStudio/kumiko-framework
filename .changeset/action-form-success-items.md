---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
---

actionForm `successItems` shows one hint per entry of a success-payload array, each with its own link; Banner gains a `hint` variant.

<!-- kumiko-changes
feature: renderer
type: improvement
title: actionForm successItems, Banner variant hint
detail: An actionForm can declare successItems { field, link? }. After a successful submit every entry of that payload array with a string label is shown as its own hint (Banner variant "hint", muted background) with the link on the right; the link resolves like a success link, but idFrom and params read from the entry. While at least one hint is shown it replaces the generic confirmation text. Boot rejects successItems together with redirect and an unknown link target; the role projection drops a link into a screen the role cannot reach and keeps the hints.
-->

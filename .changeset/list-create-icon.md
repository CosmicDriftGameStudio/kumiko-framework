---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-renderer": patch
---

List screens take `createIcon` to pick the symbol of the create button.

<!-- kumiko-changes
feature: renderer
type: improvement
title: entityList and projectionList take createIcon for the create button symbol
detail: `createIcon` (an IconKey) replaces the fixed "plus" on the list's create buttons: the header button (compact and normal) and the one in the empty state. Default stays "plus".
-->

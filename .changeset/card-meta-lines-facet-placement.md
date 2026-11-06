---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-types": patch
---

The card meta limit counts lines: a run of `narrowInline` columns is one line, as the card draws it. `narrowPlacement` also works on the `facets` of a projection list.

<!-- kumiko-changes
feature: renderer
type: fix
title: Card meta limit counts lines, projection list facets honour narrowPlacement
detail: The boot rule `list/card-meta-overflow` counted every meta column, so a run of `narrowInline` columns that the card draws on one line failed the boot. It now counts lines. `ListFacetSpec` takes `narrowPlacement`, so a facet of a projection list can open behind the filter icon on a phone, as on entity lists.
-->

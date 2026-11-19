---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

Chip facets with counts ask the list once per facet instead of once per chip.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Facet chip counts come from one grouped query per facet
detail: An entityList facet with `showCounts` or `hideEmpty` now sends one list request with `aggregate: { groupBy: <field> }` instead of one `limit: 1, totalCount: true` request per chip; a chip's count is the sum of its values' groups, a chip without values counts every row, and an answer cut at 200 groups shows no numbers. Reference chips get counts too. A counted chip facet on a multiple reference or an encrypted, personal or secret field is the new boot error `list-table/count-facet-not-groupable`. Named filter counts are unchanged.
-->

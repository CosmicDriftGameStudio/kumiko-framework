---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

The server clock header is stamped after the handler, the RLS boot catalog reads policies in one query, and the list boot rules check sort directions, summary params and badgeDot on hint columns.

<!-- kumiko-changes
feature: framework
type: fix
title: x-kumiko-now is stamped after the handler ran
detail: The header was set before the handler, so freshly written timestamps looked up to the handler runtime in the future to the client. It is now read after next(). The RLS boot catalog reads all policy shapes in one query instead of one per table. Boot rules now reject sortOptions dirs the projection query's sortDirection enum lacks, summaryRow.params keys the summary query does not know, and badgeDot on a hint column. LIST_TOOLBAR_ACTIONS_PLACEMENTS is the single source for toolbarActionsPlacement. billing-foundation process-event takes the subscription lock before reading the current subscription.
-->

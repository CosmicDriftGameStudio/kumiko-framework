---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
---

Named list filters: an entity defines a work-queue rule once, and a dashboard tile counts and opens the list with exactly that rule.

<!-- kumiko-changes
feature: framework
type: improvement
title: Entities define named list filters
detail: createEntity takes namedFilters, a record of { access?, filters(scope) } where filters returns ListFilter conditions (sync or async). The default list query accepts namedFilter and appends the resolved conditions to filters, on the row path and the aggregate path. An unknown name is a validation error on namedFilter, a failed access rule is access_denied. resolveNamedListFilters is exported from the engine entry. The definition is function-valued and never reaches the client schema.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: Lists and dashboard stats take named filters
detail: entityList and projectionList take namedFilters [{ id, label }], shown as a removable chip and kept in the URL as <screenId>.filter; it reaches the list, facet and count queries, and defaultFilters are skipped while it is active. A dashboard stat takes navigate { screen, namedFilter } and becomes a link to the filtered list. The boot validator checks that ids exist, that a projectionList query accepts namedFilter, and that the tile counts with the target list's own query and namedFilter.
-->

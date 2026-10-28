---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-framework": minor
---

Metrics can be readable by app roles and can name reference groups after the referenced row.

<!-- kumiko-changes
feature: metrics
type: improvement
title: Metric access roles and group names from a source table
detail: A metric declares `access: { roles }` to open its tenant query to roles other than the admin roles; an empty list fails boot validation and no `access` keeps the admin-only default. A `groupBy` metric on an entity-table source whose column is a single reference names the rows after the referenced row's label field; the lookup runs through the caller's read access on the target entity, so unreadable or foreign-tenant rows keep their key, and static `groupLabels` still win.
-->

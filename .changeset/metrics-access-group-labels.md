---
"@cosmicdrift/kumiko-bundled-features": minor
---

Metrics can be readable by app roles and can label groups with names from another table.

<!-- kumiko-changes
feature: metrics
type: improvement
title: Metric access roles and group names from a source table
detail: A metric declares `access: { roles }` to open its tenant query to roles other than the admin roles; an empty list fails boot validation and no `access` keeps the admin-only default. `groupLabelsFrom: { source, labelField }` replaces the raw group ids of a `groupBy` metric with the label column of the referenced rows. The lookup runs on the tenant-scoped db, so a row of another tenant is never resolved; static `groupLabels` still win.
-->

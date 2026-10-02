---
"@cosmicdrift/kumiko-framework": patch
---

Stricter boot checks for screens and handlers; apps that carried a latent typo or misconfiguration now fail at boot instead of rendering an empty cell or doing nothing at runtime.

- A plain (non-paged) query handler whose `outputSchema` declares the row shape instead of `{ rows, nextCursor }` now fails when a projectionList, relatedList, expandableRow or dashboard list panel uses it.
- `projectionDetail` layout section `fields` are checked against the query's `outputSchema`.
- A `reference` list facet requires the target's list query handler (`<feature>:query:<entity>:list`, or its central lookup override) to be registered.
- `MetricSpec.navigate.screen`/`entity` are validated even without `tab`; `navigate.entity` needs `entityId`.
- A dashboard `screen` panel must not embed an `actionForm`/`secretMint` with `redirect` or `cancelTarget`.
- `refEntity` on entityList columns and dashboard list-panel columns must resolve to a registered entity.
- `multiSelect` `display: "checkboxes"` rejects `columns` outside 1-4.
- Personal-data detection for `openToAll` write handlers now also looks inside `z.map`, `z.set`, `z.promise` and `.catchall()` schemas.
- Fixes false boot failures for cross-feature rowActions / `listScreenId` written as a fully-qualified screen QN, and for where-rules that use a bare outer column next to a qualified subquery.

<!-- kumiko-changes
feature: framework
type: improvement
title: Stricter boot checks for list outputSchema envelopes, detail section fields, reference facet list handlers, metric navigate, dashboard screen panels, refEntity columns and checkbox columns
migration: |
  Boot now fails for configurations that previously rendered empty or did nothing. Fix the named screen or field: wrap a list handler's outputSchema in { rows, nextCursor }, correct detail section field names, register the entity list handler (defineEntityListHandler) behind a reference facet, add entityId to a metric navigate.entity, drop redirect/cancelTarget on forms embedded in a dashboard, and use a registered entity for refEntity.
-->

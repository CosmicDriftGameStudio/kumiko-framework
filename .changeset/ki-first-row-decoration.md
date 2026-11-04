---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
---

List rows can get computed fields from an app query, and metric tiles can take their tone from a record field.

<!-- kumiko-changes
feature: renderer
type: improvement
title: rowDecoration on entityList and projectionList, MetricSpec.toneField
detail: entityList and projectionList take `rowDecoration: { query, params? }`. After every page answer the list calls `query` once with `{ ...params, ids }` (`ids` are the loaded row ids in row order; with infinite pagination all accumulated rows, in grouped mode the rows of the open groups) and merges the answer `{ rows: [{ id, ...fields }] }` into the rows; decoration fields win over same-named row fields, malformed entries and foreign ids are ignored. The list never waits for the decoration and shows plain rows while it loads or fails. `rowToneField`, column `hint`, `linkScreenField`/`linkParamsField`, rowAction `visible`/`params`/`payload` and entityList columns (plain text, label from `label` or the field label key) can read decoration fields. `MetricSpec.toneField` names a record field holding a SelectOptionTone that overrides `tone` (also at value 0; empty or unknown values fall back to `tone`). New boot rules `list/row-decoration-query-empty` and `list/row-decoration-ids-missing`; the decoration query must be registered (`query/not-registered`), its outputSchema fields count as known row fields, and `metrics.toneField` is checked like `summary.toneField`.
-->

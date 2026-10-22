---
"@cosmicdrift/kumiko-framework": patch
---

The where-clause builder, driver-row coercion and the event-store write verbs are split into small named steps. Generated SQL, coercion results and write errors are unchanged.

<!-- kumiko-changes
feature: framework
type: improvement
title: Where-clause emitters, coercer table and named write steps
detail: buildWhereClause() now dispatches through one emitter per WhereOperator key in a typed table, and coerceDriverRow() looks up one coercer per pgType. Table introspection, value preparation, row coercion, closed-connection handling and aggregate SQL live in their own files next to db/query.ts. The create and update write verbs run preSave, field and ownership checks, the record-lock guard, select-option checks, the version check, the append and the projection as named steps. The db barrel exports the same names as before.
-->

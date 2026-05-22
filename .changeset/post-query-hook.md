---
"@cosmicdrift/kumiko-framework": minor
---

Add `postQuery` lifecycle-hook. Fires after query-handler-execute, before field-access-read-filter (dispatcher.ts). Supports two registration paths:

- `r.hook("postQuery", "ns:query:handler", fn)` — handler-keyed, fires only for that specific query-handler
- `r.entityHook("postQuery", entity, fn)` — entity-keyed, fires for ALL query-handlers of the entity

Hook receives `{ entityName, rows }` and returns `{ rows }` (possibly modified). Each hook is responsible for its own field-access on values it adds — the built-in field-access-filter only knows the entity's stammfields.

Use-cases: tags/comments-count/computed-fields/custom-fields-merge. Part of custom-fields-bundle Sprint Phase F1 (see `kumiko-platform/docs/plans/custom-fields-sprint.md`).

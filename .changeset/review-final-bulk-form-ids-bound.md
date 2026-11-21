---
"@cosmicdrift/kumiko-framework": minor
---

Boot rejects a bulk form action whose target handler schema does not bound the ids field to `MAX_BULK_SELECTION`.

<!-- kumiko-changes
feature: framework
type: breaking
title: Bulk form actions need a bounded ids field in the handler schema
detail: `list-bulk/form-ids-field-unbounded` fails boot when the write handler of a bulk form action declares its `idsField` without `z.array(...).max(n)` and `n <= MAX_BULK_SELECTION`, in every option of a union or discriminated union. A handler schema that is not an object or a union of objects also fails, because its bound cannot be read. The client cap does not bind a direct `/api/write`, so the handler schema must. Optional and nullable wrappers are unwrapped.
migration: Declare `<idsField>: z.array(...).max(MAX_BULK_SELECTION)` in the schema of every write handler behind a bulk form action (in each option of a union), and give the handler an object schema.
affects: list-bulk, form-ids-field-unbounded, MAX_BULK_SELECTION, bulkActions
-->

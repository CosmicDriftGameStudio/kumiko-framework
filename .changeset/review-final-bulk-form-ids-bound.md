---
"@cosmicdrift/kumiko-framework": patch
---

Boot rejects a bulk form action whose target handler schema does not bound the ids field to `MAX_BULK_SELECTION`.

<!-- kumiko-changes
feature: engine
type: fix
title: Bulk form actions need a bounded ids field in the handler schema
detail: `list-bulk/form-ids-field-unbounded` fails boot when the write handler of a bulk form action declares its `idsField` without `z.array(...).max(n)` and `n <= MAX_BULK_SELECTION`. The client cap does not bind a direct `/api/write`, so the handler schema must. Optional and nullable wrappers are unwrapped.
-->

---
"@cosmicdrift/kumiko-framework": patch
---

multiSelect list filters no longer return every row for an empty array value, no longer fail with a 500 on boolean or numeric client values, and `ne` now keeps rows whose column is NULL. The forget sweeps (blind-index nulling, search purge) skip lookupable or searchable fields whose columns are missing from a migrated table instead of aborting after the key was erased, and the self-PII tenant probe ignores serial-id entities instead of throwing on a uuid subject id.

<!-- kumiko-changes
feature: framework
type: fix
title: multiSelect filters handle empty and non-string values and NULL columns; forget sweeps tolerate missing columns and serial ids
-->

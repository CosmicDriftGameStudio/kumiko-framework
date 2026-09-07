---
"@cosmicdrift/kumiko-framework": patch
---

`runPendingRebuilds` no longer logs a data-loss error for a managed table that a later migration in the same run deliberately DROPped after migrating its data elsewhere. Previously such a table was reported as `unresolvedManaged` ("now EMPTY and were NOT rebuilt ... Restore the owning feature") even though it no longer exists — it now drains silently as `unmapped` instead.

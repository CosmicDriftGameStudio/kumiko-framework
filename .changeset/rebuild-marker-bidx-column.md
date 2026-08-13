---
"@cosmicdrift/kumiko-framework": patch
---

`rebuildTablesFromDiff` now also marks a managed table rebuild-pflichtig when a new column ending in `_bidx` is added, even if the generated SQL migration is purely additive (`ALTER TABLE ADD COLUMN`). A blind-index column (from a field newly turned `lookupable: true`) is an HMAC over the decrypted value, which SQL can never backfill — only a rebuild can populate it from the event stream. Previously, migrating a `lookupable` flip left existing rows with `NULL` in the blind-index column until a manual rebuild.

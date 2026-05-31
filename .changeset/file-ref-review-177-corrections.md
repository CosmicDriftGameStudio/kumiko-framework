---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": minor
---

Follow-ups to the `fileRef` event-sourced refactor (#177):

- **`storage-tracking`**: add a handler for `fileRef.restored` so the
  tenant_storage_usage MSP re-increments after a soft-delete → restore
  round-trip. Without it `totalBytes` / `fileCount` drifted low every
  cycle.
- **`fileRef` entity**: stop declaring `insertedAt` / `insertedById` as
  entity-fields — they are framework-managed base columns. The field
  variant won the `{...baseCols, ...fieldCols}` merge in
  `buildEntityTable`, dropping `inserted_at`'s `DEFAULT now() NOT NULL`
  and making the column silently nullable.
- **`DELETE /api/files/:id`**: stop returning `404 not_found` for every
  executor failure. NotFound stays masked at 404; version-conflict /
  ownership / validation / internal surface their real httpStatus
  (409 / 403 / 422 / 500) so callers can distinguish recoverable from
  terminal failure.
- **`createUserDataRightsDefaultsFeature({ storageProvider })`**: new
  optional option. When provided, the fileRef forget delete-hook calls
  `storageProvider.delete(key)` per row before hard-deleting the row.
  Without it, file binaries leaked dauerhaft on Art. 17 forget — the
  hook logs a one-shot warn so misconfiguration stays visible.

Also documents what #177 changed without flagging at the time:
`DELETE /api/files/:id` is now a **soft-delete** (row keeps `is_deleted=
true`, binary stays on disk so restore is possible). Hard erasure of row
+ binary moves to the forget-flow (Art. 17) + data-retention cleanup —
no files-specific path. Trashed (`is_deleted=true`) files past retention
still leak their binary; the trashed-files-GC + matching `executor.purge`
API are tracked as a separate follow-up.

---
"@cosmicdrift/kumiko-framework": minor
---

Projection rebuild is now online (#363, Phase 1): both `rebuildProjection` and
`rebuildMultiStreamProjection` replay into a shadow table in a private
`kumiko_rebuild` schema and atomically swap it into `public` as the last step,
instead of holding an `ACCESS EXCLUSIVE` lock on the live table for the entire
replay via in-place `TRUNCATE`. The live projection table stays readable and
writable throughout the replay; only the final swap takes a brief lock.

Notes:
- Rebuild now requires `CREATE` privilege to provision the shared rebuild schema
  (fails loud if missing).
- The shadow table is rebuilt from `EntityTableMeta`, so an index hand-added in
  a migration but absent from meta is not reconstructed; a partial index whose
  WHERE the renderer can't express is rejected up-front.
- This is not multi-pod zero-downtime on its own: events written to the live
  table during the replay are not reflected in the shadow. Rebuild on a quiet
  entity or during a write-pause (live-tail catch-up is a later phase).

---
"@cosmicdrift/kumiko-bundled-features": patch
---

tags: rebuild `<TagSection>` as one GitLab-style multi-combobox (chips + searchable dropdown + toggle) instead of a button wall, and fix re-assign after remove. The assignment aggregate-id is deterministic, so removing a tag used to leave a `created+deleted` stream that the next assign hit with `create()` at version 0 → `version_conflict` (409); a removed `(tag, entity)` pair could never be re-attached. `tag-assignment` is now `softDelete: true` and the assign handler restores the stream (detail → restore → create), with the list query filtering removed rows.

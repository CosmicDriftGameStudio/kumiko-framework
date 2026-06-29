---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer": minor
---

tags: production-ready, GitLab-style labels

- **Colored tags**: a tag's `color` now renders as a contrast-aware chip (`TagChip`, YIQ black/white text), plus a read-only `EntityTags` chip row for cards and detail views.
- **Shared management UI**: new `TagManager` (catalog CRUD with per-tag usage counts) is mounted both as a standalone `tag-list` management screen and inside a `TagPicker` modal that returns the picked tags to the caller.
- **Edit + delete**: new `tags:write:update-tag` (optimistic-locked rename / recolor / re-scope) and `tags:write:delete-tag` (cascades over the tag's assignments) handlers.
- **Optional scope**: a tag carries an optional `scope` (empty = global, or an entity type) — GitLab group-vs-project label parity; the picker only offers global + scope-matching tags.
- **Drop-in filtering**: `TagSection` (assign/manage on any entity edit) and a `TagFilter` header-slot control that narrows any `entityList` to the rows carrying the picked tags — no host-schema change.
- **BREAKING**: `tags:write:rename-tag` is removed; use `tags:write:update-tag` (a superset that also updates color and scope).

renderer: `entityList` faceted filters now accept the base `id` column (operator `in`), and list header-slot components receive the list's `screenId`. Together these let a header control drive the list's url-filter state — the enabling change for the tags `TagFilter` drop-in.

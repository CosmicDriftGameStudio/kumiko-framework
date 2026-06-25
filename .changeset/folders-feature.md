---
"@cosmicdrift/kumiko-bundled-features": minor
---

Add `folders` — a generic, host-agnostic hierarchical folder feature for filing any entity into a nested tree where each entity lives in exactly **one** folder (re-assign = move). Mirrors `tags` but with two differences: a `folder` carries a nullable `parentId` (the tree), and the `folder-assignment` aggregate-id is keyed on `(tenantId, entityType, entityId)` **without** the folderId, so there is exactly one membership row per entity.

- `@cosmicdrift/kumiko-bundled-features/folders` — entities (`folder`, `folder-assignment`), catalog CRUD via the generic entity handlers, plus hand-written `set-folder` (upsert/move) and `clear-folder` (softDelete) write handlers.
- `@cosmicdrift/kumiko-bundled-features/folders/web` — `FolderManager` (in-screen Finder-style tree: create/rename/delete/subfolder, KPI-agnostic via a `renderMeta` render-prop), `FolderSection` (single-folder form picker via `extensionSectionComponents`), `foldersClient()`, and the pure `buildFolderTree` / `folderPath` tree helpers.
- `@cosmicdrift/kumiko-bundled-features/folders-user-data` — `EXT_USER_DATA` export/delete hooks for `folder` + `folder-assignment` so folder data is included in the GDPR (Art. 20 export / Art. 17 forget) pipeline. It hard-requires `user-data-rights` and `optionalRequires("folders")`, so it activates whenever `folders` is mounted (including tier-gated `toggleable` mounts) without emitting an "effectively disabled" boot warning.

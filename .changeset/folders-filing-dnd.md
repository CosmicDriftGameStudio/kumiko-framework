---
"@cosmicdrift/kumiko-bundled-features": minor
---

feat(folders): drag-and-drop filing in FolderManager

`FolderManager` gains an opt-in `filing` mode: a host hands in its entities
(grouped by folder + an unfiled bucket via `FolderLeaf`/`FolderFiling`) and the
manager interleaves them as draggable leaf rows. Drag a leaf onto a folder to
file it (set-folder), onto the unfiled bucket to unfile it (clear-folder); the
manager owns the reassignment writes + its catalog refetch and calls the host's
`onReassigned` to refresh assignment-derived data. Without `filing` the manager
renders exactly as before (folder management only). Guide rails are now gapless
(padding-free `min-h-9` rows) for every host.

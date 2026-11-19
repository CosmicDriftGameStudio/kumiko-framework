---
"@cosmicdrift/kumiko-bundled-features": minor
---

set-folder and clear-folder enforce the folders feature's ownership.write.

<!-- kumiko-changes
feature: folders
type: breaking
title: Folder assignments enforce ownership.write
detail: createFoldersFeature({ ownership: { write } }) now gates set-folder (create, move, restore) and clear-folder like the tags feature does. Before, the handlers wrote through an executor without the rule, so any caller with handler access could file or unfile another user's records.
migration: Direct callers of createFolderAssignmentExecutor pass the ownership option first: createFolderAssignmentExecutor(ownership, parents).
affects: createFolderAssignmentExecutor
-->

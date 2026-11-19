---
"@cosmicdrift/kumiko-bundled-features": patch
---

Folders reject an unknown or cyclic parent and refuse to delete a folder that still has child folders.

<!-- kumiko-changes
feature: folders
type: fix
title: Folder parents are checked and deletes lock against filing
detail: `folder:create` and `folder:update` answer 422 `folder_parent_not_found` when `parentId` names no live folder of the tenant, and `folder_parent_cycle` when a move would put a folder under itself or one of its descendants. `folder:delete` answers 422 `folder_has_children` while child folders exist, matching what the folder manager already enforced in the UI. `folder:delete`, `set-folder` and the parent check take an advisory lock on the folder, so a filing or a new child can no longer slip in between the delete's checks and the delete.
-->

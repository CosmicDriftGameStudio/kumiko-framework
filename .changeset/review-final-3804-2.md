---
"@cosmicdrift/kumiko-framework": patch
---

Switching off a toggleable feature no longer hides the workspace of an active feature that declares the same short workspace id. The tenant-level strip now compares the owning feature of each workspace instead of only its short id.

<!-- kumiko-changes
feature: framework
type: fix
title: disabled feature no longer removes another feature's workspace with the same id
detail: buildAppSchema records which feature owns each workspace and the feature strip removes only the workspaces of the disabled features. Two features that use the same short workspace id keep their own entries.
-->

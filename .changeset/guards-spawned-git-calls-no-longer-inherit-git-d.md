---
"@cosmicdrift/kumiko-guards": patch
---

Spawned git calls no longer inherit GIT_DIR/GIT_WORK_TREE

Guards that shell out to git now pass an allowlisted environment. Running inside a Husky pre-push hook, an inherited GIT_DIR pointed git at the hook's repo instead of the path being checked, so a guard could read and write the wrong repository.

<!-- kumiko-changes
feature: guards
type: fix
title: Spawned git calls no longer inherit GIT_DIR/GIT_WORK_TREE
-->

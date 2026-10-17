---
"@cosmicdrift/kumiko-bundled-features": patch
---

Sessions and PATs of a user removed via executor.delete are refused

<!-- kumiko-changes
feature: user
type: fix
title: Soft-deleted users no longer count as active principals
detail: |
  A user deleted through the entity executor keeps its last status (usually active) with isDeleted set. principalStatusPlugin, the session checker and the PAT role resolver only looked at the status, so existing sessions and tokens of such a user stayed valid. They now treat isDeleted as blocked (session "blocked", PAT 401, principal_blocked for membership resolution) through the new isPrincipalRowBlocked predicate.
-->

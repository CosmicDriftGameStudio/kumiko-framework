---
"@cosmicdrift/kumiko-framework": patch
---

A perTenant job on a job runner built without `context.db` now fails with a message that names the missing `context.db` when the tenant feature is mounted, instead of telling the operator to mount it. A readiness failure during `stop()` is now logged at debug level.

<!-- kumiko-changes
feature: framework
type: fix
title: perTenant fan-out without context.db reports the missing db instead of a missing tenant feature
-->

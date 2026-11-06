---
"@cosmicdrift/kumiko-bundled-features": patch
---

The notification template seed no longer deletes edited system templates it merely does not know.

<!-- kumiko-changes
feature: template-resolver
type: fix
title: Orphan cleanup keeps edited system templates of notifications unknown to the booting registry
detail: A system mail template of a mounted feature whose notification this boot does not register (conditional registration, older pod during a rolling deploy) is deleted only while the system user alone ever wrote it; an edited row is kept and logged with slug and locale. Rows of notifications renamed away through `renamedFrom` are still deleted.
-->

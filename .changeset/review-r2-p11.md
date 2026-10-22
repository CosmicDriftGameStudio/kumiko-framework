---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

Review fixes: a version conflict reuses the version the event store already reports.

<!-- kumiko-changes
feature: framework
type: fix
title: Version conflicts skip the extra stream-version lookup
detail: The CRUD executor reports the current version carried by the event store conflict and queries the stream again only when the conflict carries none.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: distinctOn documents that system reference rows compete for newest
detail: The tenant-scoped read set includes system reference rows, so they take part in the newest-row pick; the docs name the tenantId filter that restricts it to own rows, and tests pin both behaviours. Tests also cover the createDbConnection ssl and onNotice options, the version-conflict race over HTTP, and the advisory-lock waiter probe is scoped to its own lock.
-->

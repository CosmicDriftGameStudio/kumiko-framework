---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
---

Review round 3 for readiness, helpdesk, tenant-lifecycle and config: a running probe run is no longer taken over while it is alive, probe failures keep their real cause, a stuck destroy hook is no longer hidden behind a pending one, helpdesk reply upload errors and user-data lookups are no longer truncated or remapped, and the config values read keeps the declared scope.

<!-- kumiko-changes
feature: readiness
type: fix
title: Readiness probes judge running runs by startedAt
detail: readiness run-probes judges a running run by startedAt (pending by requestedAt) before abandoning it; an undecryptable starter address skips the mail probe instead of crashing the run; the storage probe no longer deletes after a failed write and a cleanup error cannot replace the original failure; RUN_OUTCOME replaces the literals and the abandoned empty-state variant comes first.
-->

<!-- kumiko-changes
feature: tenant-lifecycle
type: fix
title: Destroy accumulator and subject-key erasure
detail: The destroy accumulator reports a hook without progress as stuck even when another hook is pending; subject-key erasure no longer counts a destroying tenant as live, so two overlapping destructions with a shared member both erase the user key.
-->

<!-- kumiko-changes
feature: helpdesk
type: breaking
title: Helpdesk reply error passthrough, paged user-data lookups
detail: helpdesk reply returns the file takeover failure as is (file_rejected) instead of mapping everything to helpdesk_attachment_not_found, which is removed from HelpdeskErrors; user-data forget and export page through all requests and replies, the reply detail lists all replies; the exported SYSTEM_ADMIN_ROLE constant is removed and SystemAdmin checks use ROLES.SystemAdmin.
migration: Replace imports of SYSTEM_ADMIN_ROLE by ROLES.SystemAdmin; clients matching the helpdesk reply error helpdesk_attachment_not_found match file_rejected instead.
-->

<!-- kumiko-changes
feature: secrets
type: breaking
title: SystemAdmin checks use ROLES.SystemAdmin
detail: The exported SYSTEM_ADMIN_ROLE constant of secrets is removed; SystemAdmin checks use ROLES.SystemAdmin.
migration: Replace imports of SYSTEM_ADMIN_ROLE from secrets by ROLES.SystemAdmin.
-->

<!-- kumiko-changes
feature: config
type: fix
title: Config values read keeps the declared scope
detail: config values returns the declared scope on a widened system read.
-->

---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

Review fixes: the pending-upload sweep cannot delete a file a record just bound, a timed-out search reindex stops instead of running on, scope-free transactions reset the row-level-security settings, the boot check rejects altered isolation policies, payload scrub nulls non-text fields, boot hints name the production schema command, the sub-processor list splits Key Manager from TEM, and the xlsx export reads past short pages and allows one export per user at a time.

<!-- kumiko-changes
feature: framework
type: fix
title: review fixes for upload sweep, search reindex, row-level security, payload scrub, schema hints, sub-processors and xlsx export
detail: `executor.delete` accepts an `expect` precondition like update; the stale pending-upload sweep uses it so an upload bound after the page was read fails the delete instead of being soft-deleted. `reindexEntity` takes an `AbortSignal` and `reindexTenantsSearch` aborts a reindex that timed out. Every enforced transaction sets both row-level-security settings before its first statement, so a session-level `kumiko.scope` left on a pooled connection no longer leaks into scope-free transactions. The boot check at rowLevelSecurity "on" also fails when `kumiko_tenant_isolation` is not PERMISSIVE ALL for PUBLIC or a RESTRICTIVE policy exists, the same predicate the rebuild guard uses. `scrubEventPayloadFields` writes null instead of the text sentinel for non-string values, so typed projection columns still rebuild. Schema drift and row-level-security boot errors also name `bun /app/kumiko.js schema` for the production image. The sub-processor list has separate Scaleway Key Manager (active since 2026-07-04) and TEM entries. The xlsx export ends the list on an empty page instead of a short one, and a second export of the same user while one runs answers 429.
-->

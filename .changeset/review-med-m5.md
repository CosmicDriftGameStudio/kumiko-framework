---
"@cosmicdrift/kumiko-bundled-features": patch
---

Review fixes: new document links run postSave hooks, a past cancel no longer blocks a revocation resume, a redeemed keep-account link survives a running inactivity job, retention purge removes held-entity rows without a reference date, and the tenant destroy pending window ignores time the app slept.

<!-- kumiko-changes
feature: tenant-lifecycle
type: fix
title: review fixes for document links, termination revoke, inactivity keep race, retention hold release and destroy pending window
detail: `ensureDocumentLink` keeps the lifecycle result of a newly created link, so postSave hooks and projections on the link entity run. `hasOtherOpenProviderCancel` ignores cancel declarations that already took effect, so revoking a new cancel resumes the subscription. The inactivity state is saved only while its cycleId is unchanged and the destruction request re-checks it, so a keep link redeemed during a job run is no longer overwritten. The destroyHeld retention purge also deletes rows whose reference field is NULL, so the tenant can be released. The pending window of a tenant destroy stage counts at most 10 minutes per gap between pending ticks (new `tickAt` on pending progressed events).
-->

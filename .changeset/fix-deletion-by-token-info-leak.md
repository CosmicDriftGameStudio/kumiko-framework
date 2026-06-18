---
"@cosmicdrift/kumiko-framework": patch
---

`user-data-rights`: the anonymous `confirm-deletion-by-token` endpoint no longer
leaks the caller's account status. On a non-active user it previously returned
`startDeletionGracePeriod`'s error verbatim, whose `details.currentStatus`
exposed the live user status to anyone holding a valid token. It now returns a
generic `cannot_process_deletion` reason at the public boundary; the
authenticated `request-deletion` path still shows the user their own status.

Also corrects the (now load-bearing) comments on the deletion token: the
grace-period replay is idempotent only while no `cancel-deletion` intervenes —
after a cancel a still-valid token can re-arm a second grace period, bounded by
the token TTL. The full fix (per-request `requestId` bound into the token and
the user row) is tracked separately as it requires a shared user-entity
migration.

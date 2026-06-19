---
"@cosmicdrift/kumiko-framework": patch
---

Make user-lifecycle mutations rebuild-safe (data-loss, GDPR, #494):

The `user` feature event-sources only entity creation (`user.created`). Every
lifecycle mutation in `user-data-rights` — restrict, lift-restriction, the
deletion grace period, cancel-deletion, the email-deletion request id, and the
final forget `Deleted` flip — was a raw `updateMany` with NO event. Because the
framework auto-registers every `r.entity` as a rebuildable implicit projection,
any `read_users` rebuild replayed ONLY `user.created` and reset those columns to
their defaults: `status` back to `active`, `gracePeriodEnd` /
`pendingDeletionRequestId` to null, an Art.18 restriction or an Art.17 erasure
silently undone. Latent production data loss on a GDPR path.

Fix: the six lifecycle handlers now route through the event-store executor's
`update()` (emitting `user.updated`, which the existing implicit reducer already
replays). The `user` entity runs `r.systemScope()` but its events live on a
concrete tenant stream, and the active tenant at lifecycle time can differ from
the signup tenant — so the write is rescoped to the user's own stream tenant
(the framework-injected `read_users.tenant_id`) for both the db read and the
event, keeping `user.created` and `user.updated` on one `(tenant_id,
aggregate_id)` stream. The forget-cleanup flip stays inside its per-user
savepoint sub-transaction (the connection is threaded through), so atomicity is
preserved. A discriminating integration test (create on tenant A, lifecycle on
active tenant B, then a real projection rebuild) asserts the lifecycle state
survives — RED before the fix, GREEN after.

Existing data: the forward fix only event-sources mutations made FROM this
version on. Rows whose lifecycle state was written by the old raw path have no
`user.updated` event, so a rebuild would still reset them. A one-time reconcile
`backfillUserLifecycleEvents(conn)` (exported from `user-data-rights`) emits a
`user.updated` capturing the current live state for every divergent
`read_users` row. Apps that disabled `read_users` rebuilds as the interim
mitigation MUST run this backfill once, THEN re-enable rebuilds — not before.

No schema change.

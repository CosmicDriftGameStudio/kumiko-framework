---
"@cosmicdrift/kumiko-bundled-features": minor
---

User-stream backfill tooling + removal of the dead pre-#497 probing (#762).

- New `backfillUserStreamTenants(db)` (exported from the `user` feature): one-time migration that moves pre-#497 user event streams onto `SYSTEM_TENANT_ID`. Unlike the raw SQL documented in the #497 changeset it also merges split streams (legacy tenant + post-#497 SYSTEM events for the same aggregate) by renumbering versions in global event-id order, drops stale snapshots, and moves archived-stream markers. Idempotent, per-aggregate transactional, collects failures instead of aborting. Run once per existing deployment, then rebuild `user:projection:user-entity`.
- Removed the scattered-stream workaround that stopped working when the #497 executor choke-point landed: `tryWriteAcrossTenants`/membership probing in the confirm-token flows, the `getAggregateStreamTenant` recovery in change-password/change-email, and the row-tenant rescope in `updateUserLifecycle`. All user writes now address `SYSTEM_TENANT_ID` directly.
- confirm-token flows additionally reject rows without an event stream (`version < 1`) instead of seeding a fresh stream with a bare `user.updated`.

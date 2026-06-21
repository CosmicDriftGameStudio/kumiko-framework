---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Deterministic event-stream placement for tenant-independent aggregates (#497).

New `createEntity({ systemStream: true })` option: an aggregate flagged this way
puts its event stream on `SYSTEM_TENANT_ID` for every operation, instead of
scattering across whichever tenant happened to create it. Routing is per-entity
(opt-in), not inherited from `r.systemScope()`. The `user` entity now sets it —
a user belongs to N tenants, so its stream must not be keyed by an arbitrary
"signup-time" tenant. This removes the need for the `getAggregateStreamTenant`
recovery workaround on new data (the workaround stays for un-migrated streams).

MIGRATION REQUIRED for existing deployments: user-aggregate event streams created
before this version live on a scattered tenant. After upgrading, run once per DB:

  UPDATE kumiko_events
     SET tenant_id = '00000000-0000-4000-8000-000000000000'
   WHERE aggregate_type = 'user'
     AND tenant_id <> '00000000-0000-4000-8000-000000000000';

(The `read_users` projection has no `tenant_id` column, so no rebuild is needed.)
Without the migration, writes to existing users version-conflict because the new
code addresses their stream on SYSTEM_TENANT_ID. Deploy the migration with the
release (maintenance window), not after.

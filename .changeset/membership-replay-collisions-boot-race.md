---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-server-runtime": patch
---

The stream-tenant backfill no longer fails on two membership streams of one (user, tenant) pair, `seedTenantMembership` no longer starts such a second stream, and replicas booting at the same time no longer race on creating `kumiko_es_operations`.

<!-- kumiko-changes
feature: tenant
type: fix
title: The stream-tenant backfill archives membership streams a projection replay must not see
detail: Before the membership projection is rebuilt, the backfill reads the membership lifecycle from the event log and archives two kinds of streams. Streams of a user whose every stream is archived are archived with it, so a rebuild does not bring back memberships of users that no longer exist. When a second stream of a (userId, tenantId) pair was created while another one was still alive, the stream with the newest event stays and the others are archived; a pair that was removed and added again is left alone. Before, the rebuild failed on read_tenant_memberships_unique on every boot and the backfill stayed pending. The archived streams are logged as a warning and returned in membershipStreamsArchived. If a collision still remains, the failure says so and the step runs again on the next boot. Membership rows of archived users disappear from read_tenant_memberships with the rebuild.
-->

<!-- kumiko-changes
feature: tenant
type: fix
title: seedTenantMembership reuses the live membership stream of a pair
detail: seedTenantMembership looked only at read_tenant_memberships. After the row was lost it created a second stream for the same pair, which made every later rebuild of the projection collide. It now also checks the event log and returns the id of the pair's live stream without writing anything. The seed does not bring the lost row back; only a rebuild of the membership projection does, and nothing triggers one on its own, so until then the user has no membership in that tenant.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: Concurrent boots create kumiko_es_operations without a race
detail: CREATE TABLE IF NOT EXISTS is not race-safe in Postgres, so replicas booting against a fresh database could fail on pg_type_typname_nsp_index. createEsOperationsTable now takes an advisory lock and checks again before it creates the table.
-->

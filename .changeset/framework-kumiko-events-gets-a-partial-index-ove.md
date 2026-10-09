---
"@cosmicdrift/kumiko-framework": minor
---

kumiko_events gets a partial index over payload tenantId for tenant-membership streams

The forget-cleanup membership-history queries filter on payload->>'tenantId' and scanned all of kumiko_events. createEventsTable now also ensures events_membership_payload_tenant_idx ON kumiko_events ((payload->>'tenantId')) WHERE aggregate_type = 'tenant-membership', built CONCURRENTLY with the same INVALID-rebuild and race handling as the idempotency index. No migration: the index is created on the next boot or schema apply. On a large event history the first build takes a while but does not block appends.

<!-- kumiko-changes
feature: framework
type: improvement
title: kumiko_events gets a partial index over payload tenantId for tenant-membership streams
-->

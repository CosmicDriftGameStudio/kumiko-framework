---
"@cosmicdrift/kumiko-framework": patch
---

One tenant whose search index rejects writes no longer stops search indexing for every other tenant.

<!-- kumiko-changes
feature: framework
type: fix
title: A failing search index holds only its own tenant
detail: The search consumer runs on one ordered cursor for all tenants, so a single tenant whose Meilisearch index rejected writes (a foreign primary key, settings changed by another writer) halted indexing for every tenant until the consumer was dead-lettered. The consumer now holds only the failing tenant's events, from the first failing op on, and flushes all other tenants. Held events stay in the consumer's pending_gaps, survive restarts and are retried first, in event order, with a per-tenant backoff from 1 to 60 seconds; the consumer stays idle with lastError naming the tenant, last_failed_event_id points at the failing event so skipPoisonEvent skips exactly it, and holding never counts towards maxAttempts. A batch handler holds events through the new third argument `turn.holdForRetry(eventIds, reason)`; existing batch handlers keep their behavior. The Meilisearch adapter forgets a tenant's configured state when a write fails, so the next write re-checks the index settings instead of trusting process memory after another writer recreated the index.
-->

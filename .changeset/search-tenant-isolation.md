---
"@cosmicdrift/kumiko-framework": patch
---

One tenant whose search index rejects writes no longer stops search indexing for every other tenant.

<!-- kumiko-changes
feature: framework
type: fix
title: A failing search index holds only its own tenant
detail: The search consumer runs on one ordered cursor for all tenants, so a single tenant whose Meilisearch index rejected writes (a foreign primary key, settings changed by another writer, a poison document) halted indexing for every tenant until the consumer was dead-lettered. The consumer now holds only the failing operations, flushes everything else, and backs off per tenant from 1 to 60 seconds; while a tenant backs off, all of its operations wait so per-entity order holds. Held events stay in the consumer's pending_gaps, survive restarts and are retried first. The consumer stays idle with lastError naming the tenant, last_failed_event_id points at the failing event so skipPoisonEvent skips exactly it, and after ten failed retries in a row lastError and an error log say which event is stuck and how to skip it. Holding never counts towards maxAttempts, because dead-lettering the shared consumer is the stall for all tenants. For consumers with a batch handler, pending ids now fill at most half of a dispatcher batch, so held events cannot starve newer ones; when that cap leaves pending events out, newer events of their tenants wait as pending gaps too. Consumers without a batch handler keep the full batch for pending ids. The new dispatcher option `maxPendingGapRanges` (default 2000) bounds the cursor row: a batch consumer at the bound takes no new events and every pass that delivers nothing counts as a failed attempt, so it ends dead with lastError naming the limit and the first held event, and the existing rearm and rearm-exhausted alert take over. A batch handler holds events through the new third argument `turn.holdForRetry(eventIds, reason)`; existing batch handlers keep their behavior. The Meilisearch adapter forgets a tenant's configured state when a write fails, so the next write re-checks the index settings, and its task errors carry the Meilisearch error code and task uid but no longer the message, which can embed the rejected document.
-->

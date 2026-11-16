---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-dev-server": minor
---

The unused upcaster quarantine and its `kumiko_upcaster_dead_letters` table are removed; a failing upcaster always throws.

<!-- kumiko-changes
feature: framework
type: breaking
title: Upcaster quarantine and upcasterDeadLetterTable removed
detail: The upcaster had an `errorPolicy: "quarantine"` that wrote failing events to `kumiko_upcaster_dead_letters` and dropped them from the result. Nothing in the framework set that policy, no migration created the table, and a dropped event would have left a projection silently wrong. The policy, the table, `upcasterDeadLetterTable` (from `@cosmicdrift/kumiko-framework/event-store` and `@cosmicdrift/kumiko-dev-server/schema-tables-minimal`) and the `upcasterDeadLetters` count of the aggregate type removal are gone. A failing upcaster throws, and the consumer retries and goes dead as described in the dead-letter runbook.
migration: Remove imports of `upcasterDeadLetterTable` and reads of `deleted.upcasterDeadLetters`. If a database has a `kumiko_upcaster_dead_letters` table, read what you need from it and drop it; the framework no longer reads or writes it.
-->

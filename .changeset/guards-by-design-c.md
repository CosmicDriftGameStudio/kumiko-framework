---
"@cosmicdrift/kumiko-guards": minor
---

The Unsafe-Append-Event guard is removed because the event store enforces the same rules at runtime.

<!-- kumiko-changes
feature: guards
type: improvement
title: Unsafe-Append-Event guard removed
detail: The event store rejects unregistered event types and validates every payload against its schema at runtime, for appendEvent and unsafeAppendEvent alike, so the static guard is redundant.
migration: Delete `.kumiko-unsafe-append-event-baseline.json`.
-->

---
"@cosmicdrift/kumiko-testing": minor
---

Adds updateRowViaEventStore and deleteRowViaEventStore, test helpers that change event-sourced rows through the event store.

<!-- kumiko-changes
feature: testing
type: feature
title: Test helpers for event-store writes
detail: The testing helpers gain updateRowViaEventStore and deleteRowViaEventStore. They update or delete a row of an event-sourced table through the event-store executor, so the event log and the projection stay in step, instead of writing the projection table directly.
-->

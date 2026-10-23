---
"@cosmicdrift/kumiko-testing": minor
---

Adds updateRowViaEventStore, deleteRowViaEventStore and deleteRowsViaEventStore, test helpers that change event-sourced rows through the event store.

<!-- kumiko-changes
feature: testing
type: improvement
title: Test helpers for event-store writes
detail: The testing helpers gain updateRowViaEventStore, deleteRowViaEventStore and deleteRowsViaEventStore. They update or delete rows of an event-sourced table through the event-store executor, so the event log and the projection stay in step, instead of writing the projection table directly.
-->

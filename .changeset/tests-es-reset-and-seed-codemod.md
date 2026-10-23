---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-server-runtime": patch
---

Integration tests seed event-sourced rows through the event store and reset event-sourced tables together with the events table.

<!-- kumiko-changes
feature: testing
type: improvement
title: Tests seed and reset event-sourced tables through the event store
detail: Seeds of user, membership, tenant and other entity rows use seedRowViaEventStore instead of seedRow, so their created events exist. Setup and teardown hooks in the integration tests clear event-sourced tables through resetTestTables instead of raw DELETE statements, and clear the events table in the same call, so a test no longer starts with events whose projection rows are gone. Nothing changes for apps; the packages are only republished.
-->

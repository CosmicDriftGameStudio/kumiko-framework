---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
---

Integration tests reset event-sourced tables with resetTestTables and the events table instead of raw DELETE statements.

<!-- kumiko-changes
feature: testing
type: improvement
title: Tests reset event-sourced tables together with their events
detail: Setup and teardown hooks in the integration tests clear event-sourced tables through resetTestTables instead of raw DELETE statements, and clear the events table in the same call, so a test no longer starts with events whose projection rows are gone. Nothing changes for apps; the packages are only republished.
-->

---
"@cosmicdrift/kumiko-server-runtime": patch
---

The compose-features wiring tests reset event-sourced tables with resetTestTables.

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: Wiring tests reset event-sourced tables through resetTestTables
detail: The compose-features integration tests clear users, memberships and the event log with resetTestTables instead of deleting projection rows. Nothing changes for apps.
-->

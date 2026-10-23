---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-cli": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-framework": patch
---

Integration tests change event-sourced rows through the event store or the real commands instead of writing projection tables.

<!-- kumiko-changes
feature: testing
type: improvement
title: Tests no longer write event-sourced tables directly
detail: Integration tests for users, memberships, tenants and user-data-rights change event-sourced rows through the event store or the real commands and reset them with resetTestTables. Nothing changes for apps; the packages are only republished.
-->

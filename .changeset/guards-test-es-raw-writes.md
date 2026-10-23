---
"@cosmicdrift/kumiko-guards": patch
---

The test-es-row-writes guard also flags seedRow on event-sourced entity tables and raw DELETE/UPDATE SQL on event-sourced tables in framework tests.

<!-- kumiko-changes
feature: guards
type: improvement
title: test-es-row-writes guard covers seedRow and raw SQL on event-sourced tables
detail: Besides updateRows/deleteRows, the guard now reports seedRow on an entity table the test file builds with buildEntityTable, and raw DELETE or UPDATE statements on read_ tables, DELETE on kumiko_events and template SQL on eventsTable or such an entity table. Tests that corrupt projections, backdate timestamps or plant legacy rows on purpose are allowlisted per file with a reason. The guard runs in the framework repo only; nothing changes for apps.
-->

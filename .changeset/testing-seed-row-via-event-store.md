---
"@cosmicdrift/kumiko-testing": minor
"@cosmicdrift/kumiko-framework": patch
---

Adds seedRowViaEventStore, a test helper that seeds a row of an event-sourced entity table through the event store.

<!-- kumiko-changes
feature: testing
type: improvement
title: Seed event-sourced rows through the event store
detail: The testing helpers gain seedRowViaEventStore(db, table, values). It takes the same arguments as seedRow, appends a created event through the event-store executor and projects the row, so a rebuild keeps the seeded row. The row's tenantId selects the acting tenant; global entities such as user are seeded without a tenantId, because the executor rejects one on them. It throws for tables that are not event-sourced entity tables, for a non-string id and when the executor rejects the row. To support this, buildEntityTable and r.entity now remember which entity a managed table belongs to; nothing changes for apps.
-->

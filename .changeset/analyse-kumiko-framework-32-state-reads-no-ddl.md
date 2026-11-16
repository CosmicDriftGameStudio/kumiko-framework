---
"@cosmicdrift/kumiko-cli": patch
---

`kumiko project` and `kumiko consumer` list/status only read the database.

<!-- kumiko-changes
feature: cli
type: fix
title: kumiko project and consumer list/status no longer create tables
detail: `kumiko project list|status` and `kumiko consumer list|status` only read. On a database without kumiko_projections or kumiko_event_consumers they report that nothing has run yet instead of creating the table. `project rebuild` and `consumer restart|disable|enable|skip` still create their state table when it is missing. `project`, `consumer`, `agent` and `ops waitlist-migrate` share one check for kumiko.config.ts and DATABASE_URL with the same messages.
-->

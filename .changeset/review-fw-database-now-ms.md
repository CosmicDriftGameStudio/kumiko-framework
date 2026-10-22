---
"@cosmicdrift/kumiko-framework": patch
---

`readDatabaseNow` returns the database clock at millisecond precision, matching `events.created_at`, so comparing it against stored timestamps no longer tips on microseconds.

<!-- kumiko-changes
feature: framework
type: fix
title: Database now is rounded to milliseconds
detail: The Postgres clock read behind readDatabaseNow is cast to timestamptz(3), the precision of events.created_at, so a comparison with a stored event time is exact.
-->

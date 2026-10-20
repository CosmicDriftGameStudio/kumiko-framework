---
"@cosmicdrift/kumiko-framework": patch
---

Closing a database connection now also closes the unbounded pools that `withoutStatementTimeout` opened for runs that never finished, so a reindex abandoned by a caller-side timeout no longer keeps the database open after shutdown.

<!-- kumiko-changes
feature: framework
type: fix
title: close() ends unbounded pools of abandoned long runs
detail: withoutStatementTimeout (reindexEntity, PII backfill, projection and multi-stream rebuilds, event-store index builds) runs on its own pool without statement_timeout and closes it when the run settles. A run that never settles, such as a reindex a boot rebuild gave up on via its own timeout, kept that pool connected, so DROP DATABASE in test cleanup failed with "is being accessed by other users". The connection handle's close() now ends these pools too. A rebuild that is still running when close() is called is ended after the same close timeout instead of keeping shutdown waiting.
-->

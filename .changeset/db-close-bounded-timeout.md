---
"@cosmicdrift/kumiko-framework": patch
---

DB pool close() no longer hangs forever during an outage

<!-- kumiko-changes
feature: framework
type: fix
title: DB pool close() no longer hangs forever during an outage
detail: |
  createDbConnection/createConnection's close() and PgKmsAdapter.close()
  called client.end() with no timeout, which postgres.js waits on
  indefinitely if a query is still referenced on a dead connection — a DB
  outage during process shutdown could hang forever. close() now bounds
  the wait via a new closeTimeoutSeconds option on DbConnectionOptions
  (default 5s, DEFAULT_DB_CLOSE_TIMEOUT_SECONDS). No migration needed.
-->

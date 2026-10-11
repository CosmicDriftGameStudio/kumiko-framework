---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-server-runtime": minor
---

ctx.dbOutsideTransaction and ctx.outsideTransaction run on their own small connection pool, and the DATABASE_POOL_* settings are now actually read at boot

<!-- kumiko-changes
feature: framework
type: fix
title: Outside-transaction access no longer deadlocks against the write pool
detail: |
  ctx.dbOutsideTransaction, ctx.systemDb.outsideTransaction and ctx.outsideTransaction used the same pool as the handler's own transaction. With as many concurrent writes as pool slots, each write held a connection and waited for a second one, so every request hung forever. They now use a dedicated pool (DispatcherOptions.outsideTransactionDb) sized by the new DATABASE_OUTSIDE_TX_POOL_MAX (default 3). runProdApp and the worker boot also read DATABASE_POOL_MAX, DATABASE_POOL_IDLE_TIMEOUT and DATABASE_POOL_CONNECT_TIMEOUT now; before, production ignored them and used the postgres.js default of 10.
migration: |
  Each pod now opens up to DATABASE_POOL_MAX + DATABASE_OUTSIDE_TX_POOL_MAX connections (defaults 10 + 3) plus the LISTEN connection; check the total against Postgres max_connections, including rolling-update surge. A set but invalid DATABASE_POOL_MAX, DATABASE_POOL_IDLE_TIMEOUT, DATABASE_POOL_CONNECT_TIMEOUT or DATABASE_OUTSIDE_TX_POOL_MAX now aborts the boot. Hand-built dispatchers can pass outsideTransactionDb in DispatcherOptions; without it the app pool is shared as before.
-->

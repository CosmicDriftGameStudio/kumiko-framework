---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-testing": minor
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-cli": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-guards": patch
"@cosmicdrift/kumiko-renderer-mail-html": patch
"@cosmicdrift/kumiko-renderer-puppeteer-client": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-types": patch
---

One DB connection factory: createDbConnection({ url, ... }) on postgres-js, and the query helpers move from the bun-db subpath into the db subpath

<!-- kumiko-changes
feature: framework
type: breaking
title: createDbConnection({ url, ... }) is the only connection factory, query helpers move from /bun-db to /db
detail: |
  postgres-js is the only DB driver. createDbConnection takes one options object, is synchronous and accepts the new options ssl and onNotice. The Bun.SQL provider, createConnection, createPgConnection and DB_PROVIDER are removed. The query helpers (selectMany, insertOne, transaction, asRawClient, ...) keep their API and are now exported from @cosmicdrift/kumiko-framework/db. The `tx` handed to the transaction() callback is typed as DbTx (the postgres-js transaction handle it always was at runtime) instead of the Bun.SQL instance type; a helper that takes `db: DbConnection` and receives that tx needs `DbRunner` or `DbTx`.

  The positional form createDbConnection(url, options) and the @cosmicdrift/kumiko-framework/bun-db subpath keep working as deprecated aliases and are removed in the first release after 2026-10-29.

  old -> new:
    createConnection(url, options) (async) -> createDbConnection({ url, ...options }) (sync)
    createPgConnection(url, options) -> createDbConnection({ url, ...options })
    createDbConnection(url, options) -> createDbConnection({ url, ...options }) (positional form is deprecated)
    @cosmicdrift/kumiko-framework/bun-db -> @cosmicdrift/kumiko-framework/db (deprecated alias until the first release after 2026-10-29)

  Removed without replacement: createBunDbConnection, bunDbConnectionOptionsFromEnv, the BunDbConnection, BunDbTx, BunDbRunner and BunDbConnectionOptions types, DbPoolHandle (use DbConnectionHandle), the PgListenClient re-export from /bun-db (import it from @cosmicdrift/kumiko-types/db-connection) and the DB_PROVIDER environment variable.
migration: Run `bun kumiko-upgrade --apply`. It rewrites bun-db imports to /db, createDbConnection(url, options) and createConnection/createPgConnection calls to the object form, and reports leftovers (removed Bun.SQL exports, DB_PROVIDER) with file and line. Remove DB_PROVIDER from your env files.
codemod: scripts/codemod/db-factory.ts
-->

---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-guards": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-renderer-mail-html": patch
---

Bun.SQL is the only Postgres driver and the postgres-js fork is gone.

<!-- kumiko-changes
feature: framework
type: breaking
title: Bun.SQL replaces postgres-js as the only Postgres driver
detail: createDbConnection opens a Bun.SQL pool and needs Bun 1.4.4 or newer, the first release that drops a cached statement plan after DDL on the same connection. The handle gains listenClient for LISTEN/NOTIFY. Server errors carry the code ERR_POSTGRES_SERVER_ERROR with the SQLSTATE in errno and the constraint name in constraint; connection failures carry ERR_POSTGRES_CONNECTION_CLOSED, ERR_POSTGRES_CONNECTION_REFUSED, ERR_POSTGRES_CONNECTION_TIMEOUT or ERR_POSTGRES_CONNECTION_FAILED. extractPgError, isUniqueViolation, isTableAlreadyExists, constraintOf and the newly exported isUndefinedTable read that shape. The onNotice option is removed, because Bun.SQL has no notice hook and drops server notices. The ssl option takes Bun's tls value (a boolean, "disable", "prefer", "require", "verify-ca", "verify-full" or a TLS options object); ssl true and a TLS object without rejectUnauthorized still verify the server certificate, as they did with postgres-js. DB_PROVIDER is refused at boot for every non-empty value, "postgres" included.
migration: Read SQLSTATE and constraint only through extractPgError or the is* helpers from @cosmicdrift/kumiko-framework/db; a direct err.code === "23505" check or an err.constraint_name read no longer matches. Replace checks for CONNECTION_CLOSED, CONNECTION_ENDED, CONNECTION_DESTROYED or CONNECT_TIMEOUT with the ERR_POSTGRES_CONNECTION_* codes. Drop onNotice from createDbConnection calls. Remove DB_PROVIDER from every environment. Run on Bun 1.4.4 or newer in engines, CI and images. Code that imports postgres itself must declare its own dependency or move to Bun.SQL, since the framework no longer installs it. Manual migration, there is no codemod.
-->

<!-- kumiko-changes
feature: types
type: breaking
title: DbConnection, DbTx and PgClient are Bun.SQL types and postgres is no longer a peer dependency
detail: DbConnection is SQL | RawDbClient, DbTx is TransactionSQL | RawDbClient and PgClient is SQL from the bun module, so the package type-checks against bun-types instead of postgres. The postgres peer dependency is removed.
migration: Remove postgres from your dependencies unless your own code imports it. Annotations that named postgres.Sql or postgres.TransactionSql for framework handles become SQL and TransactionSQL from "bun", or the DbConnection and DbTx aliases. Manual migration, there is no codemod.
-->

<!-- kumiko-changes
feature: testing
type: breaking
title: captureClosedConnectionError returns a Bun.SQL error
detail: The helper opens Bun.SQL pools, so the captured error has the code ERR_POSTGRES_CONNECTION_CLOSED instead of the postgres-js CONNECTION_CLOSED. The client of createTestDb is the connection handle's listenClient, the same Bun.SQL pool as before.
migration: Tests that compared the captured error's code with CONNECTION_CLOSED compare with ERR_POSTGRES_CONNECTION_CLOSED or call isClosedConnectionError. Manual migration, there is no codemod.
-->

<!-- kumiko-changes
feature: server-runtime
type: fix
title: The renderer-web stylesheet fallback checks tailwindcss in node_modules
detail: canResolveTailwindStylesheet looks for tailwindcss in the node_modules directories above the stylesheet, as Tailwind does, instead of asking Bun.resolveSync. On Bun 1.4.4 the resolver auto-installs tailwindcss next to a renderer copy in Bun's install cache, so a build without a node_modules tree took the fallback and then failed in Tailwind with "Can't resolve 'tailwindcss'". Such a build skips the fallback stylesheet again.
-->

<!-- kumiko-changes
feature: dev-server
type: improvement
title: Scaffolded apps pin Bun 1.4.4
detail: The deploy Dockerfile template, the managed public CI workflow and the scaffolded bun-types range move from Bun 1.4.0 to 1.4.4, the minimum the Bun.SQL driver needs. The managed CI workflow updates on the next sync; the deploy Dockerfile is only written at scaffold time.
migration: Raise BUN_VERSION in an existing deploy Dockerfile to 1.4.4 and bun-types to ^1.4.4 by hand.
-->

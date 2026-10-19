---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-guards": minor
"@cosmicdrift/kumiko-cli": patch
---

HandlerContext cleanup and persistence docs. `outsideTransaction` is deprecated in favour of `runInOwnTransaction(ctx.dbOutsideTransaction, fn)`. `JobContext._userId` is gone. `ProviderPluginContext` is the public context for provider plugins, built with `providerPluginContextFromHandler` or `providerPluginContextFromJob`; `configAccessorFactory` replaces `_configAccessorFactory`. The migration splitter and the replay parser handle dollar-quoted bodies, RENAME, CREATE TABLE AS and DO blocks. A new guard flags `unsafeAppendEvent` outside migrations, upcasters and tests.

<!-- kumiko-changes
feature: types
type: improvement
title: outsideTransaction deprecated, ProviderPluginContext added
detail: HandlerContext.outsideTransaction is marked deprecated; use runInOwnTransaction(ctx.dbOutsideTransaction, fn). ProviderPluginContext is a Pick of HandlerContext for provider plugins. SharedContextFields gains configAccessorFactory; _configAccessorFactory stays as a deprecated alias. dbOutsideTransaction stays TenantDb | undefined (undefined only in the member-resolution and before-transaction denial phases and in platform-metering tenant mode); hasOutsideTransactionDb(ctx) narrows it and requireOutsideTransactionDb(ctx) throws when it is missing.
migration: Replace ctx.outsideTransaction(fn) with runInOwnTransaction(ctx.dbOutsideTransaction, fn). Read configAccessorFactory instead of _configAccessorFactory.
-->

<!-- kumiko-changes
feature: types
type: breaking
title: JobContext._userId removed
detail: The job runner never set JobContext._userId; only user-data-rights read it, falling back to SYSTEM_USER_ID. Hand-built JobContext objects that still set it fail to type-check, and code that read it must use SYSTEM_USER_ID or the job's system user.
migration: Drop _userId from hand-built JobContext objects (tests, job helpers) and replace reads of ctx._userId with SYSTEM_USER_ID. Known hits - money-horse data-export integration test, offlot-app channel-text generate-texts.job.ts.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Replay parser and migration splitter cover dollar quotes, RENAME, CREATE TABLE AS and DO
detail: splitSqlStatements keeps dollar-quoted bodies whole and throws on an unterminated one. The replay parser follows RENAME TO, RENAME COLUMN, CREATE TABLE AS and DO blocks; tables with columns it cannot derive are skipped in the schema diff. The Bun.SQL wording in db/query.ts errors and logger names now says postgres-js.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: providerPluginContextFromHandler and providerPluginContextFromJob
detail: Build a ProviderPluginContext from a HandlerContext or JobContext (jobs use the system user and have no dbOutsideTransaction).
-->

<!-- kumiko-changes
feature: waitlist
type: fix
title: migrateLegacyWaitlist no longer replays legacy events on rebuild
detail: The legacy event stream of each migrated row is archived, so a projection rebuild does not resurrect the old id next to the imported entry. The report gains archivedStreams.
-->

<!-- kumiko-changes
feature: guards
type: improvement
title: guard-unsafe-append-event
detail: Flags ctx.unsafeAppendEvent outside migrations/, upcasters/ and tests. Existing call sites are frozen per file in .kumiko-unsafe-append-event-baseline.json and the count may only shrink; repos without the file get a warning only.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: hasOutsideTransactionDb and requireOutsideTransactionDb
detail: Public helpers in the db barrel. hasOutsideTransactionDb(ctx) narrows ctx.dbOutsideTransaction to TenantDb; requireOutsideTransactionDb(ctx) returns it or throws an InternalError.
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: Provider contexts expose auditUserId instead of _userId
detail: FileProviderContext, MailTransportContext, InboundMailContext and the context read by requireSecretsContext name the audit identity auditUserId. The old underscore field is gone.
migration: Rename _userId to auditUserId wherever a provider context is built by hand (tests, custom resolvers, worker wiring). requireSecretsContext still falls back to ctx.user.id when it is unset.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Boot always sets configAccessorFactory and overrides an app value
detail: addConfigAccessorFactory writes configAccessorFactory and the _configAccessorFactory alias from the effective configResolver, replacing any app-supplied factory. The replay parser also rejects DO blocks without a dollar-quoted body and accepts tags like $do1$.
-->

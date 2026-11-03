---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-types": minor
---

Boot checks the generated schema against the booted features, the S3 endpoint rule travels with the shared schema, dropped-column migrations carry a not-empty guard, jobs read event streams through `ctx.events.load`, and the env helper `requiredEnvFor` replaces two private copies.

<!-- kumiko-changes
feature: framework
type: improvement
title: requiredEnvFor takes an optional hint and replaces the test stack's copies
detail: `requiredEnvFor(label, env, hint?)` appends the hint to the missing-variable error. The test stack (`TEST_DATABASE_URL`, `REDIS_URL`) and the S3 integration test use it instead of private `requireEnv` copies and keep their `.env.example` / `docker compose up -d` advice. server-runtime's `requireEnv` stays: its advice depends on the boot context.
-->

<!-- kumiko-changes
feature: file-provider-s3
type: fix
title: s3EndpointSchema carries the production https rule wherever it is reused
detail: The env rule lived only on the endpoint field inside `createS3EnvSchema`, so an app that built `s3EndpointSchema` into its own env schema silently lost the production check. The rule is now attached to `s3EndpointSchema` itself, env rules are found through `.optional()`, `.default()` and unions, and `s3EndpointEnvRule` is exported. With NODE_ENV=production a non-loopback `http://` endpoint is rejected by `parseEnv` and the composed boot env without app code; https and loopback http pass.
migration: Own copies of the rule (an `envRule` built on `isAcceptableS3Endpoint` next to `s3EndpointSchema`) can be removed.
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: Boot fails when the booted features declare tables the generated schema lacks
detail: `detectKumikoDrift` / `assertKumikoSchemaCurrent` take the booted features and check, once a `.snapshot.json` exists, that every table from `collectTableMetas` of those features is in it. The schema tooling (`kumiko-schema.ts`) and the boot decide `includeBundled` separately, so a differing `kumiko.config.ts` previously left tables out of the generated schema without a message. The report has the new part `tablesMissingFromSnapshot`; `runProdApp` and the worker boot pass their features. A booted table that is not in the snapshot is drift, there is no exception list.
migration: Run `kumiko schema generate` (check `includeBundled` and the feature list in `kumiko.config.ts` against what the app boots) and ship the migration. Code that builds a `KumikoDriftReport` by hand needs the new field `tablesMissingFromSnapshot`.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Generated column drops come with a commented not-empty guard
detail: For a column that disappears from an in-place table, `schema generate` emits a commented `DO $$ ... RAISE EXCEPTION '<table>.<column> is not empty' ... $$;` line directly before the commented `DROP COLUMN`. Uncommenting both aborts the migration while the column still holds values and drops it once it is empty.
-->

<!-- kumiko-changes
feature: framework
type: feature
title: Jobs read event streams with ctx.events.load
detail: `JobContext.events` gains `load(aggregateId, options?)` with the handler semantics (`asOf`, `atVersion`, `includeArchived`): scoped to the tenant of the job, payloads pass the upcaster chain. It shares its implementation with the handler `ctx.events.load`. Jobs no longer need a raw `selectMany` on `eventsTable` to read a stream.
-->

<!-- kumiko-changes
feature: types
type: improvement
title: Long external calls with writes belong in transaction perCommand
detail: A `perCommand` write handler holds no transaction or connection while an external call runs and keeps `ctx.db.outsideTransaction`, so metering and provenance bookings work there (covered by an integration test with the cap counter). The docs of `WriteHandlerTransactionMode` and `BeforeTransactionContext` say so; `beforeTransaction` keeps its read-only context.
-->

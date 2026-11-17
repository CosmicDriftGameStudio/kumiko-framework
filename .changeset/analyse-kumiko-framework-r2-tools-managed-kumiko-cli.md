---
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-framework": patch
---
`bin/kumiko.ts` is a managed file, and `schema apply` wires KMS before it applies any migration.
<!-- kumiko-changes
feature: dev-server
type: improvement
title: bin/kumiko.ts is managed by kumiko sync-managed
detail: `kumiko sync-managed` renders `bin/kumiko.ts` from a template. The file runs `runStandaloneCli` with `FEATURES` from `kumiko/schema.ts`, `envSchema` from `bin/env-schema.ts` and `rowLevelSecurity` from `kumiko.config.ts`, and sets `requireKms` when `NODE_ENV` is `production`, the same rule the scaffolded `bin/main.ts` uses for `kmsMode: "required"`. Every app gets the schema, consumer and events commands with the same KMS slots. Existing apps export `envSchema` from `bin/env-schema.ts` and adopt the file with `kumiko sync-managed --adopt --write`. `runStandaloneCli` and `runSchemaCli` accept `requireKms`; with it `schema apply` exits 1 when the KMS env is missing. `schema apply` with `features` now resolves the KMS wiring before it applies migrations, so a missing or broken KMS env leaves the database untouched instead of failing after the migrations.
-->

---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-guards": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-types": patch
---

The managed `bin/kumiko.ts` reads `process.env["INIT_CWD"]` with bracket access, so it type-checks in apps with `noPropertyAccessFromIndexSignature`. `billing-foundation:write:start-plan-checkout` and `billing-foundation:write:switch-plan` ship their title and field labels (en, de, es, fr, it), so `kumiko agent lint` no longer reports them as handler translation gaps in an app that mounts a plan catalog. The same now holds for `create-checkout-session` (field `consent`), `request-contract-termination`, `revoke-contract-termination` and `terminate-contract`.

The direct-entity-writes guard reads the entity definition as the first argument of `buildEntityTable(entityDef, options?)`, `r.crud(entityDef, options)` and `r.entity(entityDef)`, so it finds those tables again instead of reporting a misconfigured scan. `defineWriteHandler` accepts `excludedFields` on hand-written handlers and keeps it on the definition. The bundled `kumiko` CLI (`runStandaloneCli`) rejects `schema generate` and `schema baseline` with "Unknown subcommand"; both only run in development through `bun kumiko-schema`.

Projected row helpers (`insertProjectedEntityRow`, `patchProjectedEntityRow`) accept money and located timestamps in the combined form their type declares.

Upcasters and entity `eventMigrations` receive the aggregate id and type of the event they migrate (`EventUpcastCtx.aggregateId`, `EventUpcastCtx.aggregateType`).

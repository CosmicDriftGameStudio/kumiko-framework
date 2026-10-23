---
"@cosmicdrift/kumiko-guards": minor
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-dev-server": patch
---

New guard that fails when a consumer passes anything but FEATURES from kumiko/schema to runSchemaCli.

<!-- kumiko-changes
feature: guards
type: improvement
title: Guard for the runSchemaCli feature list
detail: The Schema CLI Features guard fails when a consumer's `runSchemaCli` call does not get `features: FEATURES` imported from `kumiko/schema`. `allAppFeatures()` is raw, without the bundled foundation, so the projection rebuild after the migrations failed at deploy with "Feature X requires feature Y" (kumiko-studio, 2026-10-22). The message names the fix. Repos without `kumiko/schema.ts` are skipped, and a manifest exclude cannot hide `bin/kumiko.ts`.
migration: Run `bun kumiko check` once on the bump. Measured on 2026-10-23: only show-pony fails (bin/kumiko.ts composes its own list); import `FEATURES` from `../kumiko/schema` there. publicstatus, offlot-app, solon, money-horse, phronexsis and kumiko-studio are clean.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: allAppFeatures documents that its list is raw
detail: The JSDoc of allAppFeatures says the list has no bundled foundation and that tooling such as runSchemaCli takes FEATURES from kumiko/schema. Behavior is unchanged.
-->

<!-- kumiko-changes
feature: dev-server
type: fix
title: Scaffolded bin/kumiko.ts passes FEATURES from kumiko/schema
detail: The scaffolded standalone CLI handed allAppFeatures(appConfig) to runSchemaCli, a raw list without the bundled foundation. It now imports FEATURES from kumiko/schema, which the Schema CLI Features guard requires. Existing apps are not touched.
-->

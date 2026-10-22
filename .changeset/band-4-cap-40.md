---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-dev-server": patch
---

The registry checks physical-table collisions against the table name the DDL creates, so two entities of different features with the same physical table now fail at boot. `WorkerEntrypointOptions` carries `instanceId`, and `runWorkerApp` reads `KUMIKO_INSTANCE_ID` from its `envSource`. The PII and retention validator, the cascade-delete hook, `computeListViewModel`, `applyFormatSpec` and the field projection of `buildAppSchema` are rule tables with unchanged messages and order, and the remaining German dev messages are English.

<!-- kumiko-changes
feature: framework
type: fix
title: Physical-table collisions use the DDL table name
detail: createRegistry compared entity tables under a feature-prefixed name that no DDL path creates, so an entity whose explicit table equals another feature's derived table name, or two entities with the same explicit table in different features, registered fine and then emitted the same CREATE TABLE twice. The check now uses the unprefixed physical name, the same as the store-table check and the migrate runner.
migration: Apps where two entities share a physical table name fail at boot with "has physical table ... which collides with entity ...". Give one of them a different `table`.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: Worker entrypoint takes instanceId
detail: WorkerEntrypointOptions now carries instanceId (moved to BaseEntrypointOptions, so the API and all-in-one options keep it) and createWorkerEntrypoint forwards it to the server. runWorkerApp reads KUMIKO_INSTANCE_ID from its envSource like runProdApp, so with KUMIKO_INSTANCE_ID set, per-instance consumers in the worker and its app.started event use the same id. Before, the worker server only saw process.env.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: PII, retention and cascade-delete rules as tables, English dev messages
detail: validatePiiAndRetention runs one checker per rule in a fixed order, and the cascade-delete hook dispatches each relation through a table of onDelete strategies. Error and warning texts, their order, transaction boundaries and event order are unchanged. buildAppSchema forwards field properties through an ordered table, and kumiko-upgrade and the pii-personal-migration codemod run one function per step; their output is byte-identical. The dev warnings of normalizeListColumn and buildAppSchema are now English.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: List view model and cell formats as tables
detail: computeListViewModel resolves each column through an ordered list of resolvers and applyFormatSpec dispatches through a table of cell formatters. Output is unchanged; a format named like an Object.prototype member such as "toString" still takes the unknown-format path.
-->

<!-- kumiko-changes
feature: dev-server
type: improvement
title: English buildServerBundle errors
detail: The errors for a missing bin/main.ts and a missing bin/kumiko.ts in buildServerBundle are now English.
-->

---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-server-runtime": patch
---

The boot seed dispatcher of `runProdApp` now runs the same write lifecycle as the dispatcher behind `/api/*`. Before, it got no lifecycle hooks, so seed writes and seed migrations (`seedsDir`) skipped the whole lifecycle: a file a seed stored with `createFileRef` and `attachTo` was never bound to the record the seed wrote (it kept `entity_id = null` and the file access guard answered 404 for everyone but the uploader), and preSave, postSave, preDelete and postDelete hooks, the tenant check of file references and the disposal of removed file references did not run either.

What changes for existing apps: seeds now go through the same hooks as a user write. A hook that throws inside the transaction fails the seed and with it the boot. Seeds that write on every boot run their hooks on every update, because the dedup key includes the handler version. File binding applies to seeds that write as the system user, which is the user `createFileRef` uploads as.

`ApiEntrypoint`, `AllInOneEntrypoint` and `KumikoServer` expose the hooks as `lifecycleHooks`, the same instance the API dispatcher uses.

<!-- kumiko-changes
feature: framework
type: fix
title: Seed writes run the save lifecycle, so seeded files bind to their records
detail: runProdApp built the boot seed dispatcher without lifecycle hooks, so seed writes and seed migrations skipped file binding (entity_id stayed null, other users got 404), the pre/post save and delete hooks, the tenant check of file references and the disposal of removed file references. The seed dispatcher now reuses the lifecycle hooks of the API dispatcher, exposed as lifecycleHooks on the entrypoints and on KumikoServer. A hook that throws inside the transaction now fails the seed and the boot.
-->

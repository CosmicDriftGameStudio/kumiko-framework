---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-dev-server": patch
---

The `FILE_STORAGE_PROVIDER` boot gate now reads the `env` passed to `validateBoot` (falling back to `process.env`), so an `envSource` handed to `runProdApp` with an empty `process.env` no longer fails the gate. `runDevApp` stops mutating `process.env` for an explicitly wired file provider. The derivative-key recognizer used by forget and tenant-destroy now matches the hash segment case-sensitively.

<!-- kumiko-changes
feature: framework
type: fix
title: File-storage boot gate reads the injected env, derivative erasure matches lowercase hashes only
-->

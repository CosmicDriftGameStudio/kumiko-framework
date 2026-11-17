---
"@cosmicdrift/kumiko-server-runtime": minor
---

With `NODE_ENV=production`, `runProdApp` and `runWorkerApp` default `kmsMode` to `"optional"` and `runProdApp` defaults `staticDir` to `"./dist"` when it exists; `FILE_STORAGE_PROVIDER=inmemory` aborts a production boot.

<!-- kumiko-changes
feature: server-runtime
type: breaking
title: Production boot defaults for kmsMode and staticDir
detail: Without `kmsMode`, `kms`, `blindIndexKey` and `allowPlaintextPii`, a production boot now uses `kmsMode: "optional"`: the subject-key KMS is wired when `PLATFORM_KEK`, `SUBJECT_KEYS_DATABASE_URL` and `KUMIKO_BLIND_INDEX_KEY` are set, a partial trio aborts the boot, and otherwise the PII boot gate decides as before. Without `staticDir`, `runProdApp` serves `./dist` when that folder exists. The env value `FILE_STORAGE_PROVIDER=inmemory` now aborts a production boot like the `inmemory` option does.
migration: A production env with only part of the KMS trio, or with `FILE_STORAGE_PROVIDER=inmemory`, now fails the boot: complete or remove the trio and unset the variable. Apps can drop `staticDir: "./dist"` from `bin/main.ts` and the `process.env` pin of `FILE_STORAGE_PROVIDER`; keep `kmsMode: "required"` where an empty KMS env must abort the boot.
-->

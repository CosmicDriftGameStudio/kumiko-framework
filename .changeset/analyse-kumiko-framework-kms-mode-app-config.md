---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-dev-server": patch
---

`kmsMode` moves into `kumiko.config.ts`, so `bin/main.ts` and `schema apply` in `bin/kumiko.ts` share one KMS decision.

<!-- kumiko-changes
feature: framework
type: improvement
title: kmsMode in kumiko.config.ts is the one KMS decision for boot and schema apply
detail: `defineAppConfig` takes an optional `kmsMode` (`"required"`, `"optional"` or `{ plaintextReason }`, the type `KmsMode` now lives in `@cosmicdrift/kumiko-framework/crypto` and is still exported by `@cosmicdrift/kumiko-server-runtime`) and rejects an unknown mode or an empty or placeholder reason (such as "todo"); `runProdApp` and `schema apply` apply the same check. `productionKmsMode(appConfig.kmsMode, process.env)` from `@cosmicdrift/kumiko-server-runtime` returns that mode under `NODE_ENV=production`, `"required"` when it is unset, and undefined otherwise. The managed `bin/kumiko.ts` passes `appConfig.kmsMode` to `runStandaloneCli`, which hands `schema apply` the result of `productionKmsMode`; the scaffolded `bin/main.ts` boots `runProdApp` with the same result. `runSchemaCli` takes `kmsMode` instead of `requireKms`: `"required"` exits 1 before any migration when the KMS env is missing, `{ plaintextReason }` wires no KMS and logs the reason (a plaintext app boots without KMS, so its projection rebuild must not encrypt either), `"optional"` or unset wires the KMS env when it is present. Outside production `schema apply` keeps wiring whatever KMS env is present.
migration: An app that sets `kmsMode` only in `bin/main.ts` moves it into `kumiko.config.ts` (`defineAppConfig({ ..., kmsMode: { plaintextReason: "…" } })`) and lets `bin/main.ts` read it, for example `const kmsMode = productionKmsMode(appConfig.kmsMode, process.env);` and `kmsMode !== undefined ? { kmsMode } : <local wiring>`. Without that, a plaintext app's migrate step in production exits 1 because `schema apply` requires the KMS env. An app whose `bin/main.ts` passes no `kmsMode` boots production with `"optional"` (the `runProdApp` default) and must set `kmsMode: "optional"` in `kumiko.config.ts`; otherwise `schema apply` takes `"required"` and asks for the KMS env. Apps that boot production with `kmsMode: "required"` need no change.
-->

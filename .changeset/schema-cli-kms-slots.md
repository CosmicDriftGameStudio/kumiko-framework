---
"@cosmicdrift/kumiko-framework": minor
---

kumiko schema apply can resolve the schema-declared Key Manager slots

`runSchemaCli`'s `apply` accepts a new `kmsSlots` option, passed straight through to `resolveKmsWiringAsync`'s `slots` for the rebuild-triggering KMS wiring. Given `kmsSlots`, `apply` resolves exactly those slots from their Key-Manager ciphertext (via `resolvePlatformKeks`); omitted, behavior is unchanged except that the source line it already logged now goes through the CLI's own `out.log` instead of `console.info`. `resolvePlatformKeks` will lose its three-platform-slot default in a later release, and only a caller that already passes its own slots stays unaffected when that happens. An app whose env schema declares its slots with `.meta({ kumiko: { kms: true } })` should pass `kmsSlots: kmsSlotsOf(<app>ComposedEnv.schema)` from its `bin/kumiko.ts` now. The framework core env schema does not declare `PLATFORM_KEK` / `PLATFORM_KEK_PREVIOUS` / `KUMIKO_BLIND_INDEX_KEY` as `kms` slots, so the scaffolded `bin/kumiko.ts` keeps relying on the default for now.

<!-- kumiko-changes
feature: framework
type: improvement
title: kumiko schema apply can resolve the schema-declared Key Manager slots
-->

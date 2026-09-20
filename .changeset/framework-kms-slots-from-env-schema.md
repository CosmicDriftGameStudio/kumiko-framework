---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-server-runtime": minor
---

Declare Key Manager ciphertext slots in the env schema

An env field can carry `.meta({ kumiko: { kms: true } })` to be deliverable as `<NAME>_CIPHERTEXT`. `runProdApp` now decrypts the schema-declared slots once at boot (`kmsSlotsOf(schema)` → `resolvePlatformKeks({ slots })`) and hands the resolved env to the boot-time master-key probe (`ValidateBootOptions.env`) and to the master-key keyring, so a ciphertext-only `KUMIKO_SECRETS_MASTER_KEY_V<n>` boots. `parseEnv` treats a `kms` slot as satisfied by its ciphertext twin. `composeEnvSchema` declares the `<NAME>_CIPHERTEXT` twin of every `kms` field itself (an already declared twin is kept), so a versioned family needs one declaration per version. `KUMIKO_SECRETS_MASTER_KEY_V1` of the secrets feature is such a slot. `runWorkerApp` takes the same slots as `kmsSlots` (it parses no schema). A deployment missing `KUMIKO_SECRETS_MASTER_KEY_V1` but carrying its `_CIPHERTEXT` twin now passes `parseEnv` and fails at the master-key probe if the decrypt yields nothing, instead of failing in `parseEnv`. `resolvePlatformKeks` without `slots` keeps resolving the three platform slots until consumers declare theirs.

<!-- kumiko-changes
feature: framework
type: improvement
title: Declare Key Manager ciphertext slots in the env schema
-->

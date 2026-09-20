---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-server-runtime": minor
---

Declare Key Manager ciphertext slots in the env schema

An env field can carry `.meta({ kumiko: { kms: true } })` to be deliverable as `<NAME>_CIPHERTEXT`. `runProdApp` now decrypts the schema-declared slots once at boot (`kmsSlotsOf(schema)` → `resolvePlatformKeks({ slots })`) and hands the resolved env to the boot-time master-key probe (`ValidateBootOptions.env`) and to the master-key keyring, so a ciphertext-only `KUMIKO_SECRETS_MASTER_KEY_V<n>` boots. `parseEnv` treats a `kms` slot as satisfied by its ciphertext twin. `KUMIKO_SECRETS_MASTER_KEY_V1` of the secrets feature is such a slot and gains its `_CIPHERTEXT` field. `resolvePlatformKeks` without `slots` keeps resolving the three platform slots until consumers declare theirs.

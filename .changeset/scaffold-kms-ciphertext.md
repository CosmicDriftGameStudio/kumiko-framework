---
"@cosmicdrift/kumiko-dev-server": patch
---

Scaffolded apps now boot and run `schema apply` in production when the KMS keys arrive only as Key Manager ciphertext (`PLATFORM_KEK_CIPHERTEXT`, `KUMIKO_BLIND_INDEX_KEY_CIPHERTEXT`).

<!-- kumiko-changes
feature: dev-server
type: fix
title: Scaffolded apps accept Key Manager ciphertext keys in production
detail: The generated `bin/main.ts` (demo and blank starter) boots production with `kmsMode: "required"` instead of the sync `requireKmsWiring`, which rejected every `*_CIPHERTEXT` key; local boots keep `resolveKmsWiring`. The generated `bin/kumiko.ts` passes `schema apply` the slots of `kmsEnvSchema` in addition to the app's own, so the migrate step resolves the same keys as the server. Existing apps scaffolded before this release keep their old files; copy both changes by hand if they receive ciphertext keys.
-->

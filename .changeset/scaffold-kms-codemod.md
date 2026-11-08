---
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-feature-ast": patch
---

`kumiko-upgrade --apply` now switches `bin/main.ts` and `bin/kumiko.ts` of apps scaffolded before 0.416.0 to the Key Manager ciphertext wiring.

<!-- kumiko-changes
feature: dev-server
type: fix
title: kumiko-upgrade migrates older scaffolds to Key Manager ciphertext keys
detail: The `scaffold-kms-mode` codemod replaces `requireKmsWiring` in the production branch of `bin/main.ts` with `{ kmsMode: "required" as const }` and lets `schema apply` in `bin/kumiko.ts` also resolve the slots of `kmsEnvSchema`. It only rewrites the exact scaffold form; a hand-edited file is left as it is and reported as manual.
codemod: scripts/codemod/scaffold-kms-mode.ts
-->

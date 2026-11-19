---
"@cosmicdrift/kumiko-server-runtime": patch
---

With `kmsMode: "required"` the env check lists PLATFORM_KEK, SUBJECT_KEYS_DATABASE_URL and KUMIKO_BLIND_INDEX_KEY as required, so `KUMIKO_DRY_RUN_ENV=boot` names what the boot needs.

<!-- kumiko-changes
feature: server-runtime
type: fix
title: Boot dry run lists the KMS trio under kmsMode "required"
detail: kmsMode "required" marked PLATFORM_KEK, SUBJECT_KEYS_DATABASE_URL and KUMIKO_BLIND_INDEX_KEY optional in the env schema, so KUMIKO_DRY_RUN_ENV=boot reported them as unset instead of missing and the boot only failed later in the KMS wiring. They are now required; a slot delivered as its *_CIPHERTEXT twin still counts as present. A normal boot without them fails in the env check with the variable names. Only names are printed, never values. Nothing to do for apps.
-->

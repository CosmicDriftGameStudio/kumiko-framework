---
"@cosmicdrift/kumiko-framework": patch
---

Fix `parseEnv` throwing for a refined schema with a ciphertext-only Key Manager slot

Relaxing a `kms` slot that is present only as `<NAME>_CIPHERTEXT` used `schema.extend`, which Zod 4 rejects for object schemas carrying refinements ("Cannot overwrite keys on object schemas containing refinements"). An app whose composed env schema ends in `.superRefine(...)` therefore failed at boot as soon as its slots were delivered as ciphertext. The relaxation now uses `safeExtend`, which keeps the refinements running.

<!-- kumiko-changes
feature: framework
type: fix
title: Fix parseEnv for refined env schemas with ciphertext-only Key Manager slots
-->

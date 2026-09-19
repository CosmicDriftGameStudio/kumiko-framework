---
"@cosmicdrift/kumiko-framework": minor
---

Blind-index rebuild/apply now fails loud instead of silently writing NULL (fw#3091)

`rebuildProjection` computes `*_bidx` columns via `applyEntityEvent` → `computeBlindIndexValues`, which silently returns `{}` when no blind-index key is configured — a rebuild used to write NULL into every bidx column instead of failing, breaking equality lookups on encrypted rows. `rebuildProjection` now throws before the first batch when the target table has a `*_bidx` column and `configuredBlindIndexKey()` is undefined. Separately, `blindIndexForValue` used to return `null` for a ciphertext value when no PII-subject KMS was configured (the same silent-NULL failure mode) — it now throws instead. `kumiko schema apply` (the migrate-db initContainer, standalone from `runProdApp`/`runDevApp`) now wires `KUMIKO_BLIND_INDEX_KEY`/`PLATFORM_KEK`/`SUBJECT_KEYS_DATABASE_URL` from `process.env` via `resolveKmsWiringAsync` before running queued rebuilds, closing the wiring in `finally`.

<!-- kumiko-changes
feature: framework
type: breaking
title: Blind-index rebuild/apply now fails loud instead of silently writing NULL (fw#3091)
-->

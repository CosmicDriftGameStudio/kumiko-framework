---
"@cosmicdrift/kumiko-framework": minor
---

projection-rebuild aborts instead of silently NULLing populated blind-index columns (fw#3091)

`kumiko schema apply` rebuilds a projection through a fresh shadow table replay, and the shadow always recomputes every `<field>_bidx` column with whatever blind-index key is configured in the running process. A projection rebuilt in a process without `KUMIKO_BLIND_INDEX_KEY` set — most commonly the `migrate-db` init container that runs `kumiko schema apply` on deploy — silently swapped the live table for one where every bidx column had gone NULL, breaking equality lookups (login, password reset) with no error anywhere. `rebuildProjection` now checks, right before the swap, whether the live table already has populated bidx columns while no key is configured in this process; if so it throws and leaves the live table untouched instead of completing the swap.

<!-- kumiko-changes
feature: framework
type: breaking
title: projection-rebuild aborts instead of silently NULLing populated blind-index columns (fw#3091)
migration: |
  Plaintext installations and the fw#1610 case (KMS configured, no blind-index
  key) are unaffected — their bidx columns are NULL already, so there is
  nothing for the rebuild to lose. This only blocks a rebuild that would
  otherwise destroy already-populated bidx columns: any process running
  `kumiko schema apply` (or another projection rebuild) against a table with
  live blind-index data must have `KUMIKO_BLIND_INDEX_KEY` set. Wire that env
  var into the `migrate-db` init container (or wherever schema apply runs in
  deploy) alongside the app's own KUMIKO_BLIND_INDEX_KEY, or the rebuild aborts
  instead of quietly breaking equality lookups.
-->

---
"@cosmicdrift/kumiko-bundled-features": patch
---

`readiness:query:status` reads the conditions of conditional secrets in one config read, and a probe checks at most four targets at a time.

<!-- kumiko-changes
feature: readiness
type: fix
title: Readiness status reads conditions in one batch, probe targets run four at a time
detail: `readiness:query:status` resolves every `requiredWhenConfigSet` condition through one `getCascadeBatch` call instead of one config read per secret and checks secret presence with at most four lookups in flight; the verdict is unchanged. A probe with `targets` now runs at most `PROBE_TARGET_CONCURRENCY` (4) targets at once instead of all together, so a tenant with many mailboxes or connections no longer opens them all at the same moment; a run with many targets takes correspondingly longer.
-->

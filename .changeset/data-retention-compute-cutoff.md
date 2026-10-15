---
"@cosmicdrift/kumiko-bundled-features": minor
---

data-retention exports computeCutoff

<!-- kumiko-changes
feature: data-retention
type: improvement
title: data-retention exports computeCutoff
detail: computeCutoff(keepFor, now) and its Instant type are exported from @cosmicdrift/kumiko-bundled-features/data-retention, so apps that compute a retention cutoff themselves (for example a backfill) use the same keepFor parsing as the cleanup job instead of a copy.
-->

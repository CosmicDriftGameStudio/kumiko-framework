---
"@cosmicdrift/kumiko-guards": patch
---

The As-Casts Audit names a command that runs in every repo when it asks to re-freeze its baseline.

<!-- kumiko-changes
feature: guards
type: fix
title: As-Casts Audit hints name the kumiko-guards command
detail: Every As-Casts Audit message that asks to freeze or tighten the baseline (new cast, headroom, unreadable file, format drift) now says `bun kumiko-guards guards --write-baseline --guard="As-Casts Audit"`. Before, the hints pointed at `packages/guards/src/...` source paths that exist only in the framework repo.
-->

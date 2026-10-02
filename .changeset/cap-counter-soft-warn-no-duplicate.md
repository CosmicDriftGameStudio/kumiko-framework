---
"@cosmicdrift/kumiko-bundled-features": patch
---

`markCapSoftWarned` no longer appends a second update event when a parallel warner already set `lastSoftWarnedAt`; the version-conflict retry now returns success without writing.

<!-- kumiko-changes
feature: cap-counter
type: fix
title: markCapSoftWarned skips the redundant write when the soft-warned flag is already set
-->

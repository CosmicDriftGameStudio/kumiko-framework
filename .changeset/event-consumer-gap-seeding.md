---
"@cosmicdrift/kumiko-framework": patch
---

A consumer registered with `startFrom: "now"` and the hand-off after a multi-stream projection rebuild no longer skip events whose transaction committed out of order. Both paths now seed `pending_gaps` for ids that were still in flight, so the live dispatcher delivers those events once they commit.

<!-- kumiko-changes
feature: framework
type: fix
title: startFrom "now" and MSP rebuild hand-off no longer lose out-of-order commits
-->

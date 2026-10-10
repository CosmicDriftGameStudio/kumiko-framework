---
"@cosmicdrift/kumiko-guards": patch
---

comment-lang reports an unreadable or non-object baseline instead of crashing

<!-- kumiko-changes
feature: guards
type: fix
title: comment-lang reports an unreadable or non-object baseline instead of crashing
detail: |
  `kumiko-guards comment-lang` with a baseline file that is not valid JSON, is `null` or has a `null` perFile now prints a baseline-format message and exits 1 instead of throwing a TypeError. A security baseline with the wrong shape now reports the reason `unexpected_baseline_shape`.
-->

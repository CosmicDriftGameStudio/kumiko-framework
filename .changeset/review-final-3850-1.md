---
"@cosmicdrift/kumiko-framework": patch
---

Anonymous saves never bind a pending upload. All anonymous visitors share one user id, so the pending-upload check refuses them in the shared predicate used by `bindPendingFileRef`, `loadPendingFileRef` and the save pipeline. A test now saves as one visitor with the file id another visitor stored and checks it stays unbound.

<!-- kumiko-changes
feature: framework
type: fix
title: anonymous save leaves foreign pending uploads unbound
detail: Integration test through the real write route with anonymous access, covering the save pipeline path of the pending-upload ownership check.
-->

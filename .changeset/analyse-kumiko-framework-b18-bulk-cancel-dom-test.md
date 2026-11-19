---
"@cosmicdrift/kumiko-renderer": patch
---

Bulk failure and cancel states are tested in the DOM instead of the browser.

<!-- kumiko-changes
feature: renderer
type: fix
title: Bulk cancel and failure banner covered by DOM tests
detail: The DataTable bulk DOM test checks the warning variant of the result banner after a failed row and a cancel run (four writes in flight, cancel button disabled with "Cancelling…", succeeded and not-run tallies, unstarted rows stay selected). The two renderer e2e tests for a rejected row and for cancel and the in-memory dispatcher's `rejectWriteIds`, `holdWrites` and `releaseWrites` controls are removed. No runtime behavior changes.
-->

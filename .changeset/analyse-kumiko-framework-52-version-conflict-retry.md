---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

`isVersionConflictFailure` and `retryOnceOnVersionConflict` are exported from `@cosmicdrift/kumiko-framework/errors`.

<!-- kumiko-changes
feature: framework
type: improvement
title: Retry a write once on a version conflict
detail: `isVersionConflictFailure(result)` tells whether a write result failed on a version conflict, without comparing `error.code` to a string. `retryOnceOnVersionConflict(attempt)` runs a read-modify-write again once when the first attempt lost such a race. The attempt must re-read the row it writes, so the second run checks against the state the competing write committed. A second conflict is returned as is.
-->

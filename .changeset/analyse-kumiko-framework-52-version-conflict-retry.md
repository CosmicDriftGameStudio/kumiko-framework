---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

`retryOnVersionConflict` and `VERSION_CONFLICT_CODE` are exported from `@cosmicdrift/kumiko-framework/errors`.

<!-- kumiko-changes
feature: framework
type: improvement
title: Retry a write on a version conflict
detail: `retryOnVersionConflict(attempt, { maxAttempts })` runs a read-modify-write again while it loses a stream-version race, up to `maxAttempts` attempts in total (default 2, one retry). The attempt must re-read the row it writes, so each run checks against the state the competing write committed. The last conflict is returned as is, any other result ends the loop at once, and a `maxAttempts` below 1 or not a whole number throws. `VERSION_CONFLICT_CODE` is the typed `"version_conflict"` code for checks on a raw error code; the bundled features use it instead of the string. `isVersionConflict(result)` stays the check for write results.
-->

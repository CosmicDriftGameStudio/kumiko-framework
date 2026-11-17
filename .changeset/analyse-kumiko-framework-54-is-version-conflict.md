---
"@cosmicdrift/kumiko-framework": patch
---

`isVersionConflict(result)` from `@cosmicdrift/kumiko-framework/errors` recognises a failed write that lost a stream-version race.

<!-- kumiko-changes
feature: framework
type: improvement
title: isVersionConflict replaces string checks on write results
detail: A failed WriteResult carries only the error code, so callers that retry or re-check after a concurrent write compared `error.code` with the string "version_conflict". `isVersionConflict(result)` does that check against the framework's typed error code and narrows the result to a WriteFailure.
-->

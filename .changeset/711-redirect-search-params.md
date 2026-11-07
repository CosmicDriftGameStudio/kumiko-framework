---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
---

An actionForm redirect can carry search params from the result, so a submit can land on a custom screen such as `?cmd=<id of the new thread>`.

<!-- kumiko-changes
feature: framework
type: improvement
title: actionForm redirect with searchParams to custom screens
detail: The object form of `redirect` takes `searchParams` (`{ cmd: "threadId" }` opens the target with `?cmd=<threadId>`); each value names a flat field in the success payload and a missing or non-string field leaves its param out. `idFrom` is now optional (default "id" as with the string redirect), so a redirect to a custom screen needs no record id. Boot rejects `searchParams` on non-actionForm redirects and empty keys or fields; `idFrom` on a target without an id stays rejected.
-->

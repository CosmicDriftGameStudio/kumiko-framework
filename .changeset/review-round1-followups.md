---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer": patch
---

Follow-ups from the review of the logger and cast changes: console fallbacks without a stray `undefined`, a fail-closed projection allowlist walker, typed savepoint handles.

<!-- kumiko-changes
feature: framework
type: fix
title: Fail-closed projection allowlist walk, cleaner fallback log lines
detail: createFallbackLogger no longer prints a trailing `undefined` when a log call carries no data. The step walker shared by the projection allowlist check and the workflow event-trigger registration now aborts with path and index when a sub-step list holds an entry that is not a step, instead of skipping it. The `unknown` overload of `runInSavepoint` hands its callback a `DbRunner`. Log lines drop doubled namespace prefixes, and the remaining errors in eager-load, the event store and the token request route travel as structured fields.
-->

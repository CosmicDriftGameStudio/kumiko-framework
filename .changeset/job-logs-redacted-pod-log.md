---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

A job's `ctx.obs.log.warn` and `error` now also reach the pod log, redacted.

<!-- kumiko-changes
feature: jobs
type: fix
title: Job warn and error log lines reach the pod log redacted
detail: `warn` and `error` from a job's `ctx.obs.log` are additionally written to the process logger with the message run through `redactErrorText` and only `job`, `runId` and `level` as fields; `data` and child context never go there. `info` and `debug` stay out of stdout, and the run log is unchanged. `redactErrorText`, `redactUrls`, `redactEmailAddresses` and `redactBotTokens` moved to `@cosmicdrift/kumiko-framework/logging`; `bundled-features/shared` still re-exports them.
-->

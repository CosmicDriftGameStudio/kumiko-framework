---
"@cosmicdrift/kumiko-framework": patch
---

Framework runtime warnings and errors from api, pipeline, db, boot validation, lifecycle and related modules go through the process logger instead of raw `console.*`.

<!-- kumiko-changes
feature: framework
type: fix
title: Runtime log lines go through the process logger
detail: Modules that wrote to console now use createFallbackLogger, so once setProcessLogger is wired their lines reach the configured logger with namespace and structured fields; before that they still fall back to console. createFallbackLogger gained an info method. The `[kumiko]` prefix now comes from the logger namespace, errors travel as structured fields, and the non-JSON-safe schema assertion in buildAppSchema logs the offending path instead of the whole schema.
-->

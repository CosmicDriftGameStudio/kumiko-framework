---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

`HandlerContext.triggerName` documents what it holds: the qualified name of the event that fired the job trigger, not the emitting handler.

<!-- kumiko-changes
feature: jobs
type: fix
title: triggerName is documented as the firing event's qualified name
detail: The JSDoc of `triggerName` said it names the handler that emitted the event; the job runner sets the event's qualified name, which multi-trigger jobs compare against the event QN constants.
-->

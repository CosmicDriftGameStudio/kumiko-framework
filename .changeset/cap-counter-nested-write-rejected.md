---
"@cosmicdrift/kumiko-bundled-features": patch
---

Handlers wrapped with withCapEnforcement or withRollingCapEnforcement can no longer run as nested writes

<!-- kumiko-changes
feature: cap-counter
type: breaking
title: Handlers wrapped with withCapEnforcement or withRollingCapEnforcement are rejected when called through a nested ctx.write
detail: Since the wrappers reserve through reserveBeforeTransaction, the dispatcher rejects a nested ctx.write, ctx.writeAs or handler-to-handler call of such a handler with an internal error ("has a pre-transaction phase ... cannot run as a nested write") instead of running it. Before the reservation lifecycle change the wrapped handler ran normally when called nested.
migration: Dispatch rolling- and calendar-capped handlers only as top-level commands (HTTP write or batch). A handler that calls one through ctx.write declares the cap on itself instead, or the call moves out of the handler into a client or job that dispatches a top-level command.
-->

---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

Jobs append their own events with `ctx.appendEvent`.

<!-- kumiko-changes
feature: framework
type: breaking
title: Jobs append their own events with ctx.appendEvent
detail: Jobs no longer need escapeHatch or unsafeRaw plus the low-level event-store API to append their own feature's events. The same ownership and schema rules apply as in write handlers, and the append runs in its own transaction together with the inline projections.
migration: |
  JobContext has a new required field appendEvent. Code that builds a JobContext object by hand (boot seeds, test fixtures) and does not spread bridgeStub() adds an appendEvent that throws when the code under test never appends. Jobs that appended their own feature's events through escapeHatch or unsafeRaw switch to ctx.appendEvent({ type, aggregateId, aggregateType, payload }).
-->

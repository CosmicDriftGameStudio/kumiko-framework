---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Agent-risk floor for irreversible writes

<!-- kumiko-changes
feature: framework
type: breaking
title: Irreversible writes now require agent.risk "high" on the directly-dispatched handler
migration: |
  Any write handler reachable as the directly-dispatched entry point that
  performs `executor.forget()` (any entity) or `executor.delete()` on an
  entity without `softDelete` must resolve `agent.risk: "high"`, or the
  executor gate now denies it with `access_denied` /
  `irreversible_operation_requires_high_risk` before any DB read.

  Three breaking changes ship together:
  1. Add `agent: { risk: "high" }` to your own write handler if it directly
     runs `forget` or a hard `delete` on a non-softDelete entity.
  2. Delegating via `ctx.write`/`ctx.writeAs` from a lower-risk handler into
     a high-risk forget/hard-delete handler no longer inherits the inner
     handler's risk — the outermost/entry handler's declared risk governs,
     so the delegating handler itself must be "high".
  3. Declaring `agent.risk` below "high" on a standard entity-convention
     delete handler for a non-softDelete entity is now a define-time/boot
     error instead of a silently-accepted setting.

  Standard entity-convention delete handlers on a non-softDelete entity now
  default to "high" automatically (no more implicit "always allow").

  `dispatchToolCall` treats the invoked tool itself as the entry handler,
  not the surrounding turn/approve write handler that dispatched it — a
  mid-risk "approve" handler can safely invoke a high-risk tool directly,
  but a mid-risk tool that itself delegates to a high-risk handler via
  `ctx.write`/`writeAs` is still denied per rule 2.

  `runAsDirectCallEntry` (framework `/api`) is the one sanctioned entry
  boundary: it clears the entry handler so the next dispatch counts as the
  directly called one. `dispatchToolCall` uses it because the human
  confirmation happens in approve; do not use it to lift a handler past
  the floor.

  Remaining gap: `afterCommit` hooks, jobs, and event consumers are not
  gated by this floor — they have no directly-dispatched entry handler to
  attribute risk to.
-->

---
"@cosmicdrift/kumiko-framework": minor
---

New `declareEscapeHatch({ reason: "..." })` export from `@cosmicdrift/kumiko-framework/engine`. It's a no-op statement for a standalone helper that escalates (`unsafeRaw`, `queryAs`/`writeAs` with a system identity) on a `HandlerContext` handed to it by its caller rather than one from its own registration — a shape the existing `escapeHatch: { reason: "..." }` handler/hook property can't attach to, because there's no handler/hook literal at that call site. The Escape-Hatch-Declared Guard now recognizes a `declareEscapeHatch(...)` call as the first statement of such a helper's body as covering the escalations inside that same body, with the same non-placeholder-reason check the guard already applies elsewhere.

<!-- kumiko-changes
feature: framework
type: breaking
title: declareEscapeHatch is a new export from @cosmicdrift/kumiko-framework/engine
migration: |
  A standalone helper that escalates (`unsafeRaw`, or `queryAs`/`writeAs` with a
  system identity) on a `HandlerContext` handed to it by its caller — rather than
  baselining the Escape-Hatch-Declared Guard finding — declares it at the call
  site instead: `declareEscapeHatch({ reason: "..." })` as the first statement of
  the helper's body, describing what is escalated and on whose right (the caller's
  handler still carries its own `escapeHatch` declaration). The reason must be a
  string literal and not a placeholder (see the guard's generic-reason check) —
  there is no boot validator behind this form to catch an empty or vague one.
-->

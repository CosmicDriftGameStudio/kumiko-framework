---
"@cosmicdrift/kumiko-framework": minor
---

Event-store executor writes accept a declarative `expect:` precondition

`expect: { field: value }` on an executor write applies the change only if those fields still hold at write time, turning a check-then-act sequence into one step. Values are scalars (string/number/boolean/null) compared with strict equality; several fields mean AND, and the first mismatch names its field. A failed precondition raises the new `PreconditionFailedError` instead of writing.

The precondition and the `version` used for the append are read in the same query, so a concurrent writer cannot slip between the check and the append — reading the version separately reproduced a ~40% failure rate under real concurrency. This assumes the aggregate's stream carries only auto-verb events; a raw `ctx.appendEvent` against the same aggregate would bypass the version the check relies on.

<!-- kumiko-changes
feature: framework
type: improvement
title: Event-store executor writes accept a declarative `expect:` precondition
-->

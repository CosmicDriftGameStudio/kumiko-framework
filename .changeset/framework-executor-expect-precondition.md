---
"@cosmicdrift/kumiko-framework": minor
---

Event-store executor writes accept a declarative `expect:` precondition

`expect: { field: value }` on an executor write applies the change only if those fields still hold at write time, turning a check-then-act sequence into one step. Values are scalars (string/number/boolean/null) compared with strict equality; several fields mean AND, and the first mismatch names its field. A failed precondition raises the new `PreconditionFailedError` instead of writing.

The precondition fields and the `version` used for the append are read in one query, so a concurrent writer cannot slip between the check and the append — reading them separately reproduced a ~40% failure rate under real concurrency. The version is taken from the event stream itself, not from the projection row: a projection `version` is only in step for rows the executor wrote, so a row seeded directly would otherwise be checked against a predecessor that never existed.

<!-- kumiko-changes
feature: framework
type: improvement
title: Event-store executor writes accept a declarative `expect:` precondition
-->

---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": patch
---

`StepDef.defaultFailureStrategy`, `StepInstance.onFailure` and the `StepFailureStrategy` type are removed; no step read them.

<!-- kumiko-changes
feature: types
type: breaking
title: Step definitions drop the unused failure strategy
detail: `StepFailureStrategy` only allowed "throw", and neither `StepDef.defaultFailureStrategy` nor `StepInstance.onFailure` was read at runtime: a throwing step always propagates to the dispatcher. The type and both fields are removed, and the bundled steps no longer set the field. A failure strategy comes back together with a second strategy that the runtime implements.
migration: Remove `defaultFailureStrategy: "throw"` from your own `defineStep({ ... })` calls and `onFailure` from hand-built step instances.
-->

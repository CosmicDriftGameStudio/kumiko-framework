---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
---

**Breaking:** `r.step.waitForEvent`'s `event` argument is now a branded `AwaitedEventType` instead of a raw `string`. A workflow declares the events it expects via a new `defineWorkflow({ awaits: { shipped: "order.shipped", ... } })` map, and a step can only reference one of those through `awaits.<key>` inside the `stepsPipeline` closure — `stepsPipeline`, `PipelineDef` and `PipelineBuildCtx` all gained a matching `awaits` type parameter/field for this. `buildPipelineSteps` is the sole place a raw event-type string is branded, so a typo like `awaits.shiped` is now a compile error instead of a run that suspends forever. `computeDefinitionFingerprint` folds the declared `awaits` map into the Q7 snapshot fingerprint, since changing which events a run waits on changes its routing/behavior the same way changing the step source does.

No compatibility shim: any existing `r.step.waitForEvent({ event: "some.type" })` call with a literal string must be rewritten to declare that event under the workflow's `awaits` and reference it as `awaits.<key>`.

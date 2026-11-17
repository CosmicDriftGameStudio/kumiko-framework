---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-feature-ast": minor
"create-kumiko-app": minor
---

The workflow engine is removed: `defineWorkflow`, the bundled features `workflow-runner` and `step-dispatcher`, the steps `wait`, `waitForEvent`, `retry`, `webhook.send` and `mail.send`, and the `kumiko:system:workflow.*` and `kumiko:system:step.*` system events.

<!-- kumiko-changes
feature: framework
type: breaking
title: Workflow engine, workflow-runner and step-dispatcher removed
detail: `defineWorkflow`, `computeDefinitionFingerprint`, `WorkflowDefinition`, `WorkflowStepError`, `unwrapWorkflowStepError`, `describeWorkflowStepError`, `evaluateEventMatch`, `WORKFLOW_SYSTEM_EVENT_DEFS`, the `STEP_DISPATCH_*` and `WORKFLOW_*` constants and the type `AwaitedEventType` are no longer exported. `r.step.wait`, `r.step.waitForEvent`, `r.step.retry`, `r.step.webhook.send` and `r.step.mail.send` are gone; `PipelineCtx.workflow`, `PipelineDef.awaits` and step tier 3 are removed, and `runPipeline`/`runStepList` no longer take `workflow`/`resumeFrom`. The subpaths `@cosmicdrift/kumiko-bundled-features/workflow-runner` and `/step-dispatcher` are removed, and so is the irreversible-operation case `per-dispatch-record-key`. feature-ast no longer extracts `ai.generate`/`ai.extract`/`ai.classify` patterns from `defineWorkflow` step arrays. `stepsPipeline`, `defineStep`, `r.step.callFeature` and all synchronous steps stay.
migration: Build multi-step flows as jobs triggered by events (`r.job({ trigger: { on } })`), send mail through `channel-email`/`delivery` and call webhooks from a job. Apps that mounted `createWorkflowRunnerFeature()` or `createStepDispatcherFeature()` remove the mount and run `kumiko-schema generate` to drop their tables.
-->

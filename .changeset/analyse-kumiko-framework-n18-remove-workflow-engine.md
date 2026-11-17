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
detail: `defineWorkflow`, `computeDefinitionFingerprint`, `WorkflowDefinition`, `WorkflowStepError`, `unwrapWorkflowStepError`, `describeWorkflowStepError`, `evaluateEventMatch`, `WORKFLOW_SYSTEM_EVENT_DEFS`, the `STEP_DISPATCH_*` and `WORKFLOW_*` constants (`STEP_DISPATCHED_TYPE`, `STEP_DISPATCH_AGGREGATE_TYPE`, `STEP_DISPATCH_FAILED_TYPE`, `STEP_DISPATCH_REQUESTED_TYPE`, `WORKFLOW_AGGREGATE_TYPE`, `WORKFLOW_RESUMED_TYPE`, `WORKFLOW_RETRY_SCHEDULED_TYPE`, `WORKFLOW_RUN_COMPLETED_TYPE`, `WORKFLOW_RUN_FAILED_TYPE`, `WORKFLOW_RUN_STARTED_TYPE`, `WORKFLOW_WAITING_FOR_EVENT_TYPE`, `WORKFLOW_WAITING_TYPE`) and the type `AwaitedEventType` are no longer exported. `r.step.wait`, `r.step.waitForEvent`, `r.step.retry`, `r.step.webhook.send` and `r.step.mail.send` are gone; `PipelineCtx.workflow`, `PipelineDef.awaits` and step tier 3 are removed, and `runPipeline`/`runStepList` no longer take `workflow`/`resumeFrom`. The subpaths `@cosmicdrift/kumiko-bundled-features/workflow-runner` and `/step-dispatcher` are removed, and so is the irreversible-operation case `per-dispatch-record-key`. feature-ast no longer extracts `ai.generate`/`ai.extract`/`ai.classify` patterns from `defineWorkflow` step arrays. `stepsPipeline`, `defineStep`, `r.step.callFeature` and all synchronous steps stay.
migration: Build multi-step flows as jobs triggered by events (`r.job({ trigger: { on } })`), send mail through `channel-email`/`delivery` and call webhooks from a job. Apps that mounted `createWorkflowRunnerFeature()` or `createStepDispatcherFeature()` remove the mount and run `kumiko-schema generate` to drop their tables.
affects: defineWorkflow, workflow-runner, step-dispatcher, createWorkflowRunnerFeature, createStepDispatcherFeature, step.wait, step.retry, step.webhook, step.mail, WorkflowDefinition, WorkflowStepError, evaluateEventMatch, computeDefinitionFingerprint, WORKFLOW_, STEP_DISPATCH_, AwaitedEventType, PipelineDef, ctx.workflow, resumeFrom, per-dispatch-record-key
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: step-dispatcher feature removed
detail: The subpath @cosmicdrift/kumiko-bundled-features/step-dispatcher is gone with all its exports: `createStepDispatcherFeature`, `STEP_DISPATCH_AGGREGATE_TYPE`, `MailSpec`, `mailSpecSchema`, `MailDispatchResult`, `performMailDispatch`, `setMailRunner`, `WebhookSpec`, `webhookSpecSchema`, `WebhookDispatchDeps`, `WebhookDispatchResult`, `performWebhookDispatch`, `setWebhookFetch`, `setWebhookHostLookup`, `webhookAuthSecretKey`, `WEBHOOK_AUTH_SECRET_KEY_PREFIX`, `WEBHOOK_ALLOWED_PRIVATE_HOSTS_ENV_VAR`, `readAllowedPrivateWebhookHostsFromEnv` and `stepDispatcherEnvSchema`. It only served the removed `webhook.send` and `mail.send` workflow steps.
migration: There is no replacement feature. Send mail through channel-email or delivery and call webhooks from a job; remove the createStepDispatcherFeature mount.
affects: step-dispatcher, createStepDispatcherFeature, performMailDispatch, performWebhookDispatch, setMailRunner, setWebhookFetch, setWebhookHostLookup, stepDispatcherEnvSchema
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: workflow-runner feature removed
detail: The subpath @cosmicdrift/kumiko-bundled-features/workflow-runner is gone with all its exports: `createWorkflowRunnerFeature`, `startAndRunWorkflow`, `registerEventTrigger`, `workflowRunAggregateId`, `WorkflowSuspensionUnsupportedError`, `WorkflowRunStartedPayload`, `WorkflowRunCompletedPayload` and `WorkflowRunFailedPayload`.
migration: There is no replacement feature. Build multi-step flows as jobs triggered by events (`r.job({ trigger: { on } })`); remove the createWorkflowRunnerFeature mount.
affects: workflow-runner, createWorkflowRunnerFeature, startAndRunWorkflow, registerEventTrigger
-->

---
"@cosmicdrift/kumiko-framework": minor
---

The workflow run-stream events (`kumiko:system:workflow.run-started`, `run-completed`, `run-failed`, `step.waiting`, `step.waiting-for-event`, `step.resumed`, `retry.scheduled`) are now registered events under their existing names. `r.extendEntityProjection(entity, { sources: [WORKFLOW_AGGREGATE_TYPE], apply: { [WORKFLOW_RUN_FAILED_TYPE]: ... } })` passes boot validation, so a run-state read model can be rebuilt from the workflow stream without the ghost-row abort. Appending these events still skips payload validation, and stored events are unchanged. `buildManifestFromRegistry` lists them under the new `systemEvents` key.

<!-- kumiko-changes
feature: framework
type: improvement
title: Workflow run-stream events are registered, so projections can apply them
detail: |
  `WORKFLOW_SYSTEM_EVENT_DEFS` declares the seven `kumiko:system:workflow.*` events with a payload schema, version 1 and the stance from `SYSTEM_EVENT_PII_STANCES`. `createRegistry` seeds them into the event map next to `r.defineEvent` events, so apply-key validation, the PII catalog and the upcaster chain see them. A typo such as `kumiko:system:workflow.run-faild` still fails boot. `appendDomainEventCore` keeps skipping schema validation for `kumiko:system:*` types. The feature manifest gains an optional top-level `systemEvents` list.
migration: |
  A projection whose row ids are not the workflow-run aggregate id (for example uuidv5-derived ids) still cannot pass the ghost-row guard and needs its own change: its row id must equal the workflow-run aggregate id (this applies to kumiko-enterprise's run-state projection). Hand-built `FeatureManifest` objects stay valid because `systemEvents` is optional; regenerate committed manifests with `bun run gen:manifest` in `samples/apps/use-all-bundled` to pick the list up.
-->

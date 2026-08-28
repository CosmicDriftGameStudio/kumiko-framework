// kumiko-feature-version: 1
//
// workflow-runner — writes the run-envelope (run-started / run-completed /
// run-failed) for a workflow run onto its workflow-run aggregate stream.
//
// This feature registers no workflows of its own — consumers define a
// WorkflowDefinition via `defineWorkflow` and wire it up with
// `registerEventTrigger(r, myWorkflow)` inside their own feature. Mounting
// `workflowRunnerFeature` documents that dependency and reserves the
// picker/manifest slot; it has no MSPs or entities to register itself.
//
// No resume-loop is bundled yet (framework#2480) — workflows that use
// suspending steps (wait / waitForEvent / retry) fail loud via
// WorkflowSuspensionUnsupportedError instead of hanging silently.

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

// Kebab-case matching the "./workflow-runner" export subpath — every other
// bundled feature's runtime name follows this convention, and
// FEATURE_IMPORT_REGISTRY (use-all-bundled) keys off it.
const FEATURE_NAME = "workflow-runner";

export const workflowRunnerFeature = defineFeature(FEATURE_NAME, (r) => {
  r.describe(
    "Writes the run-envelope (`workflow.run-started` / `workflow.run-completed` / `workflow.run-failed`) for a workflow run onto its `workflow-run` aggregate stream. Provides `startAndRunWorkflow` and `registerEventTrigger` for consumer features to wire up `defineWorkflow`-based workflows against domain events. Registers no workflows itself. No resume-loop is bundled yet (framework#2480) — suspending steps (wait/waitForEvent/retry) fail the run instead of pausing it.",
  );
  r.uiHints({
    displayLabel: "Workflow Runner",
    category: "infrastructure",
    recommended: false,
  });
});

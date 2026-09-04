// kumiko-feature-version: 1
//
// workflow-runner — writes the run-envelope (run-started / run-completed /
// run-failed) for a workflow run onto its workflow-run aggregate stream.
//
// This feature registers no workflows of its own — consumers define a
// WorkflowDefinition via `defineWorkflow` and wire it up with
// `registerEventTrigger(r, myWorkflow)` inside their own feature. Mounting
// `workflowRunnerFeature` documents that dependency and reserves the
// picker/manifest slot.
//
// It also registers the resume loop (framework#2513 Phase 2 + 3b):
//   - the workflow_run_pending MSP (Phase 1) materialises suspended
//     wait/waitForEvent/retry steps into a pending-set table
//   - the `resume-due-runs` cron job (perTenant) scans that table for
//     `wakeAt < now()` rows and dispatches `resume-run` per row — the job
//     itself does no resume logic, only SELECT + dispatch
//   - the `resume-run` write handler (r.systemScope(), SYSTEM_ROLE-only)
//     does the actual Q7-check + claim + pipeline re-entry
//   - `registerEventTrigger` (event-trigger.ts) additionally registers an
//     event-wakeup MSP per workflow that declares `awaits` — it marks the
//     matching pending row due as soon as the awaited event arrives,
//     instead of waiting out the full timeout (event-subscriber.ts)
//
// wait/retry/waitForEvent suspensions all resume automatically now.

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { selectDueWorkflowRunPending } from "./db/queries/due-runs";
import { resumeRunHandler } from "./handlers/resume-run.write";
import { registerWorkflowRunPendingProjection } from "./pending-projection";
import { workflowRunPendingTableMeta } from "./tables";

// Kebab-case matching the "./workflow-runner" export subpath — every other
// bundled feature's runtime name follows this convention, and
// FEATURE_IMPORT_REGISTRY (use-all-bundled) keys off it.
const FEATURE_NAME = "workflow-runner";

export const workflowRunnerFeature = defineFeature(FEATURE_NAME, (r) => {
  r.describe(
    "Writes the run-envelope (`workflow.run-started` / `workflow.run-completed` / `workflow.run-failed`) for a workflow run onto its `workflow-run` aggregate stream. Provides `startAndRunWorkflow` and `registerEventTrigger` for consumer features to wire up `defineWorkflow`-based workflows against domain events. Registers no workflows itself. Runs the resume loop for suspended `wait`/`retry`/`waitForEvent` steps (`resume-due-runs` job + `resume-run` handler); `registerEventTrigger` wires an event-wakeup subscriber per workflow that declares `awaits` so a `waitForEvent` step resumes as soon as its awaited event arrives, not just on timeout.",
  );
  r.uiHints({
    displayLabel: "Workflow Runner",
    category: "infrastructure",
    recommended: false,
  });
  // resume-run needs a full HandlerContext + ctx.systemDb (the pending-row
  // scan crosses whatever tenant the row belongs to relative to the job's
  // own tenant loop iteration) — same reasoning as tenant/feature.ts.
  r.systemScope();
  r.storeTable(workflowRunPendingTableMeta, {
    reason: "resume_loop.pending_suspended_steps",
  });
  registerWorkflowRunPendingProjection(r);
  r.writeHandler(resumeRunHandler);

  r.job(
    "resume-due-runs",
    { trigger: { cron: "* * * * *" }, perTenant: true, concurrency: "skip" },
    async (_payload, ctx) => {
      if (!ctx.db) {
        throw new Error("resume-due-runs: ctx.db required (JobContext incomplete)");
      }
      const tenantId = ctx.systemUser?.tenantId ?? ctx._tenantId;
      if (tenantId === undefined) {
        // skip: cron fired without a perTenant fan-out tenant — nothing scoped
        return;
      }

      const dueRows = await selectDueWorkflowRunPending(ctx.db, tenantId);

      for (const row of dueRows) {
        try {
          await ctx.write("workflow-runner:write:resume-run", {
            runId: row.run_id,
            stepIndex: row.step_index,
          });
        } catch (error) {
          // skip: one row's dispatch failing (infra hiccup, not a business
          // outcome — resume-run itself never throws for expected cases)
          // must not stop the rest of this tenant's due rows from resuming.
          ctx.log.warn(
            `[workflow-runner:resume-due-runs] runId=${row.run_id} stepIndex=${row.step_index} dispatch failed: ${String(error)}`,
          );
        }
      }
    },
  );
});

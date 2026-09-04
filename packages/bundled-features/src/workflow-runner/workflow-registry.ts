// workflow-registry — process-local lookup from workflow name to its
// WorkflowDefinition. registerEventTrigger populates it at feature-
// registration time; resume-run (Phase 2) is the only reader — it has
// nothing but a workflow name on the pending row and needs the live
// definition to rebuild the pipeline + recompute the Q7 fingerprint.
//
// Overwrite-on-same-name, no throw: unlike defineStep's registry (which
// throws on a duplicate kind — a real programming error), redefining a
// workflow under the same name is a legitimate deploy-time occurrence
// (the whole point of Q7 is detecting exactly that changed-definition case
// downstream, not preventing the registration).

import type { WorkflowDefinition } from "@cosmicdrift/kumiko-framework/engine";

const registry = new Map<string, WorkflowDefinition>();

export function registerWorkflow(workflow: WorkflowDefinition): void {
  registry.set(workflow.name, workflow);
}

export function getWorkflow(name: string): WorkflowDefinition | undefined {
  return registry.get(name);
}

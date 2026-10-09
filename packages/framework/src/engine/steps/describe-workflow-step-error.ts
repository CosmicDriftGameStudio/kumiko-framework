// Workflow events (run-failed, retry.scheduled) outlive an Art. 17 erase, and a
// raw error message can echo recipients or payload fragments. Events carry only
// this generic text; the raw error goes to the log.
import { unwrapWorkflowStepError } from "./workflow-step-error.js";

export function describeWorkflowStepError(error: unknown): string {
  const original = unwrapWorkflowStepError(error);
  return `workflow step failed (${original instanceof Error ? original.name : "unknown error"})`;
}

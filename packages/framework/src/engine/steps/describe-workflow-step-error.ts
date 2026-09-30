// Workflow events (run-failed, retry.scheduled) outlive an Art. 17 erase, and a
// raw error message can echo recipients or payload fragments. Events carry only
// this generic text; the raw error goes to the log.
export function describeWorkflowStepError(error: unknown): string {
  return `workflow step failed (${error instanceof Error ? error.name : "unknown error"})`;
}

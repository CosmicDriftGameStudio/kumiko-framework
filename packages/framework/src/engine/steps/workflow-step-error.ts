// Carries the top-level step index a workflow run failed at, so run-failed
// events don't have to guess it. `cause` stays the original throw.
export class WorkflowStepError extends Error {
  constructor(
    readonly stepIndex: number,
    cause: unknown,
  ) {
    super(`workflow step ${stepIndex} failed`, { cause });
    this.name = "WorkflowStepError";
  }
}

export function unwrapWorkflowStepError(error: unknown): unknown {
  return error instanceof WorkflowStepError ? error.cause : error;
}

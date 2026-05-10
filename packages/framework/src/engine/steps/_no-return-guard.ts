// Build-time guard for Q12 — sub-pipelines (branch.onTrue/onFalse,
// forEach.do) may not contain r.step.return. Centralised here so the
// error message is wordlaut-identical across both sub-step-builders;
// inline duplication would drift the moment someone edits one site.
//
// Extracted at the second sub-step-builder rather than the third because
// the drift-risk on the Q12 wording is real (advisor M.1.6 cleanup), not
// because the line-count alone justifies it.

import type { StepInstance } from "../types/step";

export function validateNoReturnSteps(steps: readonly StepInstance[], where: string): void {
  for (const step of steps) {
    if (step.kind === "return") {
      throw new Error(
        `r.step.return is not allowed inside ${where} — branch/forEach are side-effect containers (Q12). ` +
          `Restructure the pipeline so the return happens at the top level.`,
      );
    }
  }
}

export type BootViolation = {
  readonly ruleId: string;
  readonly check: string;
  readonly feature?: string;
  readonly message: string;
  readonly fix?: string;
};

function describeViolation(violation: BootViolation): string {
  const line = `- [${violation.ruleId}] ${violation.message}`;
  return violation.fix === undefined ? line : `${line}\n  Fix: ${violation.fix}`;
}

export class BootValidationError extends Error {
  override readonly name = "BootValidationError";

  constructor(readonly violations: readonly BootViolation[]) {
    const count = violations.length;
    const header = `Boot validation failed: ${count} violation${count === 1 ? "" : "s"}`;
    super([header, ...violations.map(describeViolation)].join("\n"));
  }
}

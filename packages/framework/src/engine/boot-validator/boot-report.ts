import { BootValidationError, type BootViolation } from "./boot-rule.ts";

// A runtime crash is a bug in a validator (or in the input it assumed), not a
// rule violation: it must surface as itself instead of masquerading as a finding.
function isRuntimeCrash(thrown: unknown): boolean {
  return (
    !(thrown instanceof Error) ||
    thrown instanceof TypeError ||
    thrown instanceof RangeError ||
    thrown instanceof ReferenceError ||
    thrown instanceof SyntaxError ||
    thrown instanceof EvalError ||
    thrown instanceof URIError
  );
}

export type BootReport = {
  check(checkName: string, feature: string | undefined, fn: () => unknown): boolean;
  endPhase(): void;
  finish(): void;
};

export function createBootReport(): BootReport {
  const violations: BootViolation[] = [];
  let firstCrash: { readonly thrown: unknown } | undefined;

  function endPhase(): void {
    // Crashes are discarded next to violations: they are most likely follow-ups of the broken input.
    if (violations.length > 0) throw new BootValidationError([...violations]);
    if (firstCrash !== undefined) throw firstCrash.thrown;
  }

  return {
    check(checkName, feature, fn) {
      try {
        fn();
        return true;
      } catch (thrown) {
        if (isRuntimeCrash(thrown)) {
          firstCrash ??= { thrown };
        } else if (thrown instanceof Error) {
          violations.push({
            ruleId: `unclassified/${checkName}`,
            check: checkName,
            ...(feature === undefined ? {} : { feature }),
            message: thrown.message,
          });
        }
        return false;
      }
    },
    endPhase,
    finish: endPhase,
  };
}

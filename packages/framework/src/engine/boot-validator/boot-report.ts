import {
  BootRuleFailures,
  BootRuleViolation,
  BootValidationError,
  type BootViolation,
} from "./boot-rule.ts";

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

function violationsOf(
  failure: Error,
  checkName: string,
  feature: string | undefined,
): readonly BootViolation[] {
  if (failure instanceof BootRuleFailures) {
    return failure.failures.flatMap((nested) => violationsOf(nested, checkName, feature));
  }
  if (failure instanceof BootValidationError) return failure.violations;
  const featurePart = feature === undefined ? {} : { feature };
  if (failure instanceof BootRuleViolation) {
    return [
      {
        ruleId: failure.rule.id,
        check: checkName,
        ...featurePart,
        message: failure.message,
        fix: failure.rule.fix,
      },
    ];
  }
  return [
    {
      ruleId: `unclassified/${checkName}`,
      check: checkName,
      ...featurePart,
      message: failure.message,
    },
  ];
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
          violations.push(...violationsOf(thrown, checkName, feature));
        }
        return false;
      }
    },
    endPhase,
    finish: endPhase,
  };
}

// Boundary per item: every item runs, so one boot reports all independent violations
// instead of only the first. Crashes behave as in endPhase: dropped next to failures.
export function collectBootRuleViolations<T>(items: Iterable<T>, run: (item: T) => void): void {
  const failures: Error[] = [];
  let firstCrash: { readonly thrown: unknown } | undefined;
  for (const item of items) {
    try {
      run(item);
    } catch (thrown) {
      if (isRuntimeCrash(thrown)) {
        firstCrash ??= { thrown };
      } else if (thrown instanceof BootRuleFailures) {
        failures.push(...thrown.failures);
      } else if (thrown instanceof Error) {
        failures.push(thrown);
      }
    }
  }
  const [onlyFailure] = failures;
  if (onlyFailure !== undefined && failures.length === 1) throw onlyFailure;
  if (failures.length > 1) throw new BootRuleFailures(failures);
  if (firstCrash !== undefined) throw firstCrash.thrown;
}

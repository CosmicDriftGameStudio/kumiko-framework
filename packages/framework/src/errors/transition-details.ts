// Shared detail shape for invalid_transition errors. Both paths
// (`state-machine.assertTransition` and `failTransition`) must provide
// identically structured details so HTTP clients can parse the 422 body uniformly:
// `from`/`to`/`allowed` are the structured fields, while `message` is the
// human-readable form.
//
// `validTargets` is not re-exported as a CSV string; callers that need CSV can use
// `allowed.join(", ")`. One shape defines the contract.

export type InvalidTransitionDetails = {
  readonly from: string;
  readonly to: string;
  readonly allowed: readonly string[];
  readonly message: string;
};

export function buildInvalidTransitionDetails(
  from: string,
  to: string,
  allowed: readonly string[],
): InvalidTransitionDetails {
  return {
    from,
    to,
    allowed,
    message: `Invalid transition: "${from}" → "${to}". Allowed from "${from}": ${
      allowed.length > 0 ? allowed.join(", ") : "none"
    }`,
  };
}

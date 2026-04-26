// Gemeinsame Detail-Shape für invalid_transition-Errors. Beide Pfade
// (state-machine.assertTransition + failTransition) müssen identisch
// strukturierte Details liefern, sonst können HTTP-Clients den 422-Body
// nicht uniform parsen — `from`/`to`/`allowed` sind die strukturierten
// Felder, `message` ist die menschen-lesbare Form.
//
// Kein Re-Export von "validTargets" (CSV-string) mehr — wer CSV will
// baut's via `allowed.join(", ")`. Eine Shape, ein Vertrag.

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

import { FrameworkReasons, UnprocessableError } from "../errors";

/**
 * Type-safe transition graph. Wraps the underlying Map so callers don't
 * accidentally fall into the `transitions[from]?.includes(to)` footgun
 * (Object-Index-Access auf einer Map returnt undefined und der ganze
 * Check kollabiert silently). Stattdessen forciert die API explizite
 * Methoden — kein Map-shape mehr extern sichtbar.
 *
 * - `canTransition(from, to)` → boolean
 * - `allowedFrom(from)` → readonly string[] (leer wenn `from` unbekannt
 *   oder terminaler Zustand)
 * - `assertTransition(from, to)` → wirft UnprocessableError(invalid_transition)
 */
export type TransitionGraph<TStates extends string = string> = {
  readonly canTransition: (from: TStates, to: TStates) => boolean;
  readonly allowedFrom: (from: TStates) => readonly TStates[];
  readonly assertTransition: (from: TStates, to: TStates) => void;
};

/**
 * Defines allowed state transitions. Returns a typed graph (see
 * TransitionGraph) — nicht eine Map. Damit ist `transitions[x]`-Zugriff
 * type-error statt silent undefined.
 */
export function defineTransitions<const TMap extends Record<string, readonly string[]>>(
  map: TMap,
): TransitionGraph<keyof TMap & string> {
  type TStates = keyof TMap & string;
  const internal = new Map<string, ReadonlySet<string>>();
  for (const [from, targets] of Object.entries(map)) {
    internal.set(from, new Set(targets));
  }

  return {
    canTransition: (from, to) => internal.get(from)?.has(to) === true,
    allowedFrom: (from) => {
      const set = internal.get(from);
      return set ? ([...set] as TStates[]) : [];
    },
    assertTransition: (from, to) => {
      if (internal.get(from)?.has(to) === true) return;
      const allowed = internal.get(from);
      const validTargets = allowed ? [...allowed].join(", ") : "none";
      throw new UnprocessableError(FrameworkReasons.invalidTransition, {
        i18nKey: "errors.invalidTransition",
        details: {
          from,
          to,
          validTargets,
          message: `Invalid transition: "${from}" → "${to}". Allowed from "${from}": ${validTargets}`,
        },
      });
    },
  };
}

/**
 * Asserts a state transition is allowed. Throws UnprocessableError with
 * reason="invalid_transition" if not — the 422 status lets the client
 * distinguish a logical rejection from a validation or auth failure.
 *
 * Convenience-Wrapper um `transitions.assertTransition(from, to)` —
 * existiert weil bestehende Aufrufer `guardTransition(graph, ...)`-Form
 * nutzen. Beides ist erlaubt; die Method-Form auf dem Graph ist die
 * idiomatische API für neuen Code.
 */
export function guardTransition<TStates extends string>(
  transitions: TransitionGraph<TStates>,
  from: TStates,
  to: TStates,
): void {
  transitions.assertTransition(from, to);
}

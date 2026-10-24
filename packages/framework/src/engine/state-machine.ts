import { FrameworkReasons, UnprocessableError } from "../errors/index.ts";
import { buildInvalidTransitionDetails } from "../errors/transition-details.ts";

/**
 * Type-safe transition graph. Wraps the underlying Map so callers don't
 * accidentally fall into the `transitions[from]?.includes(to)` footgun
 * (indexing a Map like an object returns undefined and silently breaks the
 * entire check). The API therefore enforces explicit methods, with no Map
 * shape exposed externally.
 *
 * - `canTransition(from, to)` → boolean
 * - `allowedFrom(from)` → readonly string[] (empty when `from` is unknown
 *   or terminal)
 * - `assertTransition(from, to)` → throws UnprocessableError(invalid_transition)
 */
export type TransitionGraph<TStates extends string = string> = {
  readonly canTransition: (from: TStates, to: TStates) => boolean;
  readonly allowedFrom: (from: TStates) => readonly TStates[];
  readonly assertTransition: (from: TStates, to: TStates) => void;
};

/**
 * Defines allowed state transitions. Returns a typed graph (see
 * TransitionGraph), not a Map. This makes `transitions[x]` access a
 * type error instead of silently returning undefined.
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
      return set ? ([...set] as TStates[]) : []; // @cast-boundary schema-walk
    },
    assertTransition: (from, to) => {
      const set = internal.get(from);
      // skip: allowed transition — no throw; fall through.
      if (set?.has(to) === true) return;
      const allowed = set ? [...set] : [];
      throw new UnprocessableError(FrameworkReasons.invalidTransition, {
        i18nKey: "errors.invalidTransition",
        details: buildInvalidTransitionDetails(from, to, allowed),
      });
    },
  };
}

/**
 * Asserts a state transition is allowed. Throws UnprocessableError with
 * reason="invalid_transition" if not — the 422 status lets the client
 * distinguish a logical rejection from a validation or auth failure.
 *
 * Convenience wrapper around `transitions.assertTransition(from, to)` —
 * it exists because existing callers use the `guardTransition(graph, ...)`
 * form. Both are supported; the graph method is the idiomatic API for new
 * code.
 */
// @wrapper-known semantic-alias
export function guardTransition<TStates extends string>(
  transitions: TransitionGraph<TStates>,
  from: TStates,
  to: TStates,
): void {
  transitions.assertTransition(from, to);
}

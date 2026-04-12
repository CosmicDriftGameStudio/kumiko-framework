import { FrameworkError } from "./errors";

/**
 * Defines allowed state transitions as a map: current state → allowed target states.
 * Pure data structure — no side effects, no framework magic.
 */
export function defineTransitions<TState extends string>(
  map: Record<TState, readonly TState[]>,
): ReadonlyMap<TState, ReadonlySet<TState>> {
  const result = new Map<TState, ReadonlySet<TState>>();
  for (const [from, targets] of Object.entries(map)) {
    result.set(from as TState, new Set(targets as readonly TState[]));
  }
  return result;
}

/**
 * Asserts a state transition is allowed. Throws TransitionError if not.
 * Use in WriteHandlers for manual transition control.
 */
export function guardTransition<TState extends string>(
  transitions: ReadonlyMap<TState, ReadonlySet<TState>>,
  from: TState,
  to: TState,
): void {
  const allowed = transitions.get(from);
  if (!allowed || !allowed.has(to)) {
    const validTargets = allowed ? [...allowed].join(", ") : "none";
    throw new FrameworkError(
      "validation_failed",
      `Invalid transition: "${from}" → "${to}". Allowed from "${from}": ${validTargets}`,
    );
  }
}

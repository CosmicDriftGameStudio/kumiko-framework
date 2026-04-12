import { FrameworkError } from "./errors";

/**
 * Defines allowed state transitions as a map: current state → allowed target states.
 * Pure data structure — no side effects, no framework magic.
 */
export function defineTransitions<const TMap extends Record<string, readonly string[]>>(
  map: TMap,
): ReadonlyMap<string, ReadonlySet<string>> {
  const result = new Map<string, ReadonlySet<string>>();
  for (const [from, targets] of Object.entries(map)) {
    result.set(from, new Set(targets));
  }
  return result;
}

/**
 * Asserts a state transition is allowed. Throws FrameworkError if not.
 * Use in WriteHandlers for manual transition control.
 */
export function guardTransition(
  transitions: ReadonlyMap<string, ReadonlySet<string>>,
  from: string,
  to: string,
): void {
  const allowed = transitions.get(from);
  if (!allowed?.has(to)) {
    const validTargets = allowed ? [...allowed].join(", ") : "none";
    throw new FrameworkError(
      "validation_failed",
      `Invalid transition: "${from}" → "${to}". Allowed from "${from}": ${validTargets}`,
    );
  }
}

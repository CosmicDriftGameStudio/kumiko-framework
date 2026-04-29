// Shallow equality — Object.is on each own enumerable key. The
// recommended Equality-Arg for useStoreSelector when the selector
// returns a plain object/array literal (`s => ({ a: s.a, b: s.b })`),
// which would otherwise produce a fresh reference each render and
// trip useSyncExternalStore's identity check.
//
// Mirrors Zustand's `shallow` and react-redux's `shallowEqual` — same
//8-line shape, no recursion. Apps that need deep equality reach for
// their own helper.

// Signature is `(a: unknown, b: unknown)` not `<T>(a: T, b: T)` because the
// function legitimately compares cross-type values (primitive vs. object,
// null vs. {}, etc.) and returns false for mismatches. A generic `<T>`
// would force callers into type-gymnastics for those cases. Contra-variance
// ensures this still satisfies `(a: S, b: S) => boolean` slots like
// useStoreSelector's `equals` arg.
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || a === null) return false;
  if (typeof b !== "object" || b === null) return false;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.hasOwn(b, key)) return false;
    if (!Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      // @cast-boundary generic-record
      return false;
    }
  }
  return true;
}

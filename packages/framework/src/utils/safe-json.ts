/**
 * Safe JSON parsing — never let invalid input from Redis/DB/external systems
 * crash the pipeline silently. Two variants for two different semantics:
 *
 * - parseJsonSafe(raw, fallback): for caches and idempotent reads. Corrupt
 *   input is treated as "not there" (fallback returned). The caller continues
 *   as if the cache missed.
 * - parseJsonOrThrow(raw, context): for inputs where corruption is a real bug
 *   (config values, job payloads, broker messages addressed to us). Throws
 *   with a clear context message so the stack trace points to the boundary.
 */

export function parseJsonSafe<T>(raw: string, fallback: T): T {
  try {
    // @cast-boundary engine-bridge — generic parser-helper centralizes the cast
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function parseJsonOrThrow<T>(raw: string, context: string): T {
  try {
    // @cast-boundary engine-bridge — generic parser-helper centralizes the cast
    return JSON.parse(raw) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in ${context}: ${msg}`);
  }
}

/** JSON.stringify that survives BigInt values from DB rows.
 *  Temporal.Instant serializes via its own toJSON() — no Instant branch needed
 *  (and `v instanceof Temporal.Instant` would ReferenceError without ambient). */
export function stringifyJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (typeof v === "bigint") {
      const asNumber = Number(v);
      if (
        asNumber <= Number.MAX_SAFE_INTEGER &&
        asNumber >= Number.MIN_SAFE_INTEGER &&
        BigInt(asNumber) === v
      ) {
        return asNumber;
      }
      return v.toString();
    }
    return v;
  });
}

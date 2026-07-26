/** Shared grace-period check for user-data-rights + tenant-lifecycle cancel flows. */

import { Temporal as TemporalPolyfill } from "temporal-polyfill";

/**
 * True when `gracePeriodEnd` is still in the future.
 * Uses the polyfill Instant API so callers don't depend on `globalThis.Temporal`.
 */
export function isWithinGracePeriod(gracePeriodEnd: Temporal.Instant | null): boolean {
  // @cast-boundary temporal-polyfill-vs-ambient: same TC39 Temporal.Instant
  // at runtime — row types resolve against ambient Temporal; polyfill Instant
  // is a separate nominal type across the two .d.ts sources.
  return (
    gracePeriodEnd != null &&
    TemporalPolyfill.Instant.compare(
      gracePeriodEnd as unknown as InstanceType<typeof TemporalPolyfill.Instant>,
      TemporalPolyfill.Now.instant(),
    ) > 0
  );
}

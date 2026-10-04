/// <reference types="temporal-polyfill/global" preserve="true" />
/** Shared grace-period check for user-data-rights + tenant-lifecycle cancel flows. */

import { Temporal } from "@cosmicdrift/kumiko-types/temporal";

/**
 * True when `gracePeriodEnd` is still in the future.
 * Uses the module's Temporal so callers don't depend on `globalThis.Temporal`.
 */
export function isWithinGracePeriod(gracePeriodEnd: Temporal.Instant | null): boolean {
  return (
    gracePeriodEnd != null && Temporal.Instant.compare(gracePeriodEnd, Temporal.Now.instant()) > 0
  );
}

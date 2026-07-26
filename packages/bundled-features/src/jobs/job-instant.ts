import { Temporal } from "temporal-polyfill";

// kumiko-framework#1525: the five value-position Temporal.Instant.from
// call sites in feature.ts live inside defineApply callbacks with no
// exported seam, so this thin wrapper gives the ambient-global-independence
// regression test something to import directly.
export function parseJobInstant(iso: string): Temporal.Instant {
  return Temporal.Instant.from(iso);
}

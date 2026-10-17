import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import type { Clock } from "@cosmicdrift/kumiko-types/tz-context";

// Instant arithmetic rejects calendar units (days and larger).
type ClockStep = {
  readonly hours?: number;
  readonly minutes?: number;
  readonly seconds?: number;
  readonly milliseconds?: number;
};

export type ManualClock = Clock & {
  set(instant: Temporal.Instant): void;
  advance(step: ClockStep): void;
};

export function createManualClock(start: Temporal.Instant): ManualClock {
  let current = start;
  return {
    now: () => current,
    set: (instant) => {
      current = instant;
    },
    advance: (step) => {
      current = current.add(step);
    },
  };
}

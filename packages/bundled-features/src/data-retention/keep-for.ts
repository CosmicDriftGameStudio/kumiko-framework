// keepFor format parser: "30d" / "10y" / "6m" / "1w" / "24h" → cutoff instant.
//
// Not millisecond-precise — GDPR retention requirements use day/month
// granularity. "6m" = 6×30d, "10y" = 10×365d. The cleanup job runs daily,
// so a difference of a few days at the cutoff is acceptable.
//
// The boot validator already checked the format against /^\d+[hdwmy]$/
// — validate defensively again here for migration edge cases.
//
// Temporal is provided via globalThis (the polyfill is installed during framework boot).
// `getTemporal()` from framework/time provides typed access.

import { getTemporal } from "@cosmicdrift/kumiko-framework/time";

const KEEP_FOR_PATTERN = /^(\d+)([hdwmy])$/;

const UNIT_TO_DAYS: Readonly<Record<string, number>> = {
  d: 1,
  w: 7,
  m: 30,
  y: 365,
} satisfies Readonly<Record<string, number>>;

export class InvalidKeepForError extends Error {
  constructor(spec: string) {
    super(
      `Invalid keepFor format "${spec}" — expected /^\\d+[hdwmy]$/ (e.g. "30d", "10y", "6m", "1w", "24h")`,
    );
  }
}

// Re-export Temporal.Instant as a type alias so callers do not have to obtain
// the type from globalThis themselves.
export type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;

/**
 * Computes the cutoff instant — rows with reference < cutoff are expired
 * and removed by the cleanup job.
 *
 * @param spec keepFor string such as "30d", "10y", "6m", "1w", "24h"
 * @param now Current point in time (injection parameter for time-travel tests;
 *            not global Temporal.Now)
 */
export function computeCutoff(spec: string, now: Instant): Instant {
  const match = KEEP_FOR_PATTERN.exec(spec);
  if (!match) {
    throw new InvalidKeepForError(spec);
  }
  const amount = Number.parseInt(match[1] ?? "0", 10);
  const unit = match[2] ?? "";

  if (unit === "h") {
    return now.subtract({ hours: amount });
  }

  const daysFactor = UNIT_TO_DAYS[unit];
  if (daysFactor === undefined) {
    throw new InvalidKeepForError(spec);
  }
  return now.subtract({ hours: amount * daysFactor * 24 });
}

/**
 * Determines whether referenceTimestamp is older than the keepFor cutoff at now.
 * The cleanup job uses this for each row.
 */
export function isPastCutoff(args: {
  readonly referenceTimestamp: Instant;
  readonly keepFor: string;
  readonly now: Instant;
}): boolean {
  const T = getTemporal();
  const cutoff = computeCutoff(args.keepFor, args.now);
  return T.Instant.compare(args.referenceTimestamp, cutoff) < 0;
}

// Converts between DurationSpec, SQL intervals, and Temporal.Duration.
//
// `ComplianceProfile.userRights.gracePeriod` is
// `{ days: number } | { hours: number }` (a discriminated union). Callers
// inserting it into a Postgres `interval` need one trusted conversion point;
// otherwise an `{ hours: 6 }` override could silently use a days default.
//
// This is the single source of truth. Other spec forms (months/years) in the
// retention path use the broader `keep-for` parser and are deliberately not
// supported here, keeping the type narrow and SQL rendering total.

import { getTemporal } from "../time/index.ts";
import type { DurationSpec, RetentionSpec } from "./profiles.ts";

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;

// Millisecond representation of the spec. All conversions use this source
// of truth, including Instant addition and optional JavaScript date handling.
export function durationSpecToMs(spec: DurationSpec): number {
  if ("days" in spec) return spec.days * 24 * 60 * 60 * 1000;
  return spec.hours * 60 * 60 * 1000;
}

// Computes the deadline without DB-now(); the app server clock is
// authoritative. This is used for Forget-Grace, token TTLs, and deadline
// assignments where a difference of a few milliseconds between the app and
// database is irrelevant (grace periods >= 6h, tokens >= minutes).
//
// Writes directly to `instant()` custom-type columns—no interval SQL
// fragment or codec bypass.
export function addDurationSpec(now: Instant, spec: DurationSpec): Instant {
  return getTemporal().Instant.fromEpochMilliseconds(
    now.epochMilliseconds + durationSpecToMs(spec),
  );
}

// Human-readable descriptions for logs and error messages. Not localized;
// operator output is English-only.
// Calendar-aware cutoff: months/years are subtracted on a UTC calendar so
// "24 months" is not approximated as 730 fixed days (leap years, month ends).
export function subtractRetentionSpec(now: Instant, spec: RetentionSpec): Instant {
  if ("months" in spec) {
    return now.toZonedDateTimeISO("UTC").subtract({ months: spec.months }).toInstant();
  }
  if ("years" in spec) {
    return now.toZonedDateTimeISO("UTC").subtract({ years: spec.years }).toInstant();
  }
  return getTemporal().Instant.fromEpochMilliseconds(
    now.epochMilliseconds - durationSpecToMs(spec),
  );
}

import { Temporal } from "temporal-polyfill";

// Shared timestamp formatter for operator screens (audit log, job runs) —
// falls back to the raw ISO string on an unparseable value instead of "Invalid Date".
export function formatWhen(value: string): string {
  try {
    return Temporal.Instant.from(value).toLocaleString();
  } catch {
    // Temporal.Instant.from requires a UTC designator/offset — offset-less
    // timestamps (still valid `new Date` input) throw here. Retry as a
    // local wall-clock time before giving up and returning the raw string.
    try {
      return Temporal.PlainDateTime.from(value)
        .toZonedDateTime(Temporal.Now.timeZoneId())
        .toInstant()
        .toLocaleString();
    } catch {
      return value;
    }
  }
}

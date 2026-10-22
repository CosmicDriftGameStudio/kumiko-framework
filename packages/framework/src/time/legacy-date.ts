import { Temporal } from "@cosmicdrift/kumiko-types/temporal";

// Bridge to libraries that require JS `Date` (imapflow
// search({since}), nodemailer headers, ...). Feature code uses Temporal and
// converts only at foreign-API boundaries, keeping the no-date-api guard
// effective outside this allowlisted time layer.

export function instantToLegacyDate(instant: Temporal.Instant): Date {
  return new Date(instant.epochMilliseconds);
}

/** Converts dates from foreign libraries (imapflow INTERNALDATE,
 *  mailparser Date headers) to Temporal.Instant. */
export function legacyDateToInstant(date: Date): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(date.getTime());
}

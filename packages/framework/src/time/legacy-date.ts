import { Temporal } from "temporal-polyfill";

// Temporal→Date-Bridge für Lib-APIs die JS-Date verlangen (imapflow
// search({since}), nodemailer-Header, ...). Gegenstück zur
// dateToInstant-Richtung der DB-/Event-Store-Boundaries: Feature-Code
// rechnet in Temporal, konvertiert erst am Aufruf der Fremd-API — der
// no-date-api-Guard bleibt für Feature-Code scharf, die Konstruktion
// lebt hier im allowlisteten Time-Layer.

export function instantToLegacyDate(instant: Temporal.Instant): Date {
  return new Date(instant.epochMilliseconds);
}

/** Gegenrichtung: Date aus einer Fremd-Lib (imapflow INTERNALDATE,
 *  mailparser Date-Header) → Temporal.Instant. */
export function legacyDateToInstant(date: Date): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(date.getTime());
}

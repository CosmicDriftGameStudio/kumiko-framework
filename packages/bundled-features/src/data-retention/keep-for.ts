// keepFor-Format-Parser: "30d" / "10y" / "6m" / "1w" / "24h" → Cutoff-Instant.
//
// Nicht millisekunden-praezise — DSGVO-Aufbewahrungspflichten haben
// Tag-/Monat-Granularitaet. "6m" = 6×30d, "10y" = 10×365d. Cleanup-Job
// laeuft taeglich, ein paar Tage Differenz beim Cutoff sind akzeptabel.
//
// Boot-Validator (S0.2) hat das Format schon gegen /^\d+[hdwmy]$/
// gecheckt — hier defensiv nochmal validiert fuer Migration-Edge-Cases.
//
// Temporal kommt via globalThis (Polyfill in framework-Boot installiert).
// `getTemporal()` aus framework/time gibt typed Zugriff.

import { getTemporal } from "@cosmicdrift/kumiko-framework/time";

const KEEP_FOR_PATTERN = /^(\d+)([hdwmy])$/;

const UNIT_TO_DAYS: Readonly<Record<string, number>> = {
  d: 1,
  w: 7,
  m: 30,
  y: 365,
};

export class InvalidKeepForError extends Error {
  constructor(spec: string) {
    super(
      `Invalid keepFor format "${spec}" — expected /^\\d+[hdwmy]$/ (e.g. "30d", "10y", "6m", "1w", "24h")`,
    );
  }
}

// Re-export von Temporal.Instant als Type-Alias damit Caller den Type
// nicht selbst aus globalThis ziehen muessen.
export type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;

/**
 * Berechnet den Cutoff-Instant — Rows mit reference < cutoff sind
 * abgelaufen und werden vom Cleanup-Job geraeumt.
 *
 * @param spec keepFor-String wie "30d", "10y", "6m", "1w", "24h"
 * @param now Aktueller Zeitpunkt (advisor-Pattern: injection-Parameter
 *            fuer Time-Travel-Tests, kein global Temporal.Now)
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
 * Ist referenceTimestamp aelter als der keepFor-Cutoff bei now?
 * Cleanup-Job nutzt das pro Row.
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

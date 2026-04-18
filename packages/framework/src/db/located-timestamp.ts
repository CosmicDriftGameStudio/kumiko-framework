// Auto-Convert für locatedTimestamp-Felder im DB-Layer.
//
// Vertrag (siehe auch db/money.ts — gleicher Compound-Type-Pattern):
//   API-Form:    { at, tz } | { utc, tz }
//   DB-Form:     <name>Utc TIMESTAMPTZ + <name>Tz TEXT
//   Read-Form:   { at, tz, utc }
//
// `at`-Default-Sicht beim Read: Pickup-Ort-lokal (utc projiziert in
// gespeicherter tz). Server kennt User-TZ nicht — User-spezifische
// Anzeige passiert client-seitig aus utc.

import type { EntityDefinition } from "../engine/types";

// PG liefert für TIMESTAMPTZ im mode:"string" das Wire-Format
// "2026-04-15 09:00:00+00". Temporal erwartet ISO-8601 mit "T" und
// entweder "Z" oder "+HH:MM". Mini-Adapter normalisiert.
function pgTimestamptzToInstantIso(pgValue: string): string {
  if (pgValue.includes("T")) return pgValue;
  return pgValue.replace(" ", "T").replace(/\+00$/, "Z");
}

/**
 * API → DB: locatedTimestamp-Felder zu zwei flachen Spalten flatten.
 *
 * - `{ at, tz }` (UI-Form) → `{ <name>Utc, <name>Tz }` (utc via Temporal berechnet)
 * - `{ utc, tz }` (Server-Form) → utc gewinnt direkt
 * - `{ at, tz, utc }` → utc gewinnt; at wird ignoriert (Konsistenz-Check ist
 *   Caller-Verantwortung)
 *
 * Pure — mutiert nicht.
 */
export function flattenLocatedTimestamp(
  payload: Record<string, unknown>,
  entity: EntityDefinition,
): Record<string, unknown> {
  const T = (globalThis as unknown as { Temporal: typeof Temporal }).Temporal;
  const result: Record<string, unknown> = { ...payload };

  for (const [name, field] of Object.entries(entity.fields)) {
    if (field.type !== "locatedTimestamp") continue;

    const raw = result[name];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== "object") {
      throw new Error(
        `flattenLocatedTimestamp: field "${name}" expects { at, tz } or { utc, tz } object, got ${typeof raw}`,
      );
    }
    const pair = raw as { at?: string; tz?: string; utc?: string };

    delete result[name];

    if (pair.tz === undefined) continue;
    const tz = pair.tz;
    const utc =
      pair.utc ??
      (pair.at !== undefined
        ? T.PlainDateTime.from(pair.at).toZonedDateTime(tz).toInstant().toString()
        : undefined);
    if (utc === undefined) continue;

    result[`${name}Utc`] = utc;
    result[`${name}Tz`] = tz;
  }

  return result;
}

/**
 * DB → API: zwei flache Spalten zu combined { at, tz, utc } rehydraten.
 *
 * `at` ist immer Wall-Clock in der gespeicherten `tz` (Pickup-Ort-lokal).
 * Wer User-Sicht braucht, leitet aus `utc` selbst ab — der Server kennt
 * keine User-TZ.
 *
 * Pure — mutiert nicht.
 */
export function rehydrateLocatedTimestamp(
  row: Record<string, unknown>,
  entity: EntityDefinition,
): Record<string, unknown> {
  const T = (globalThis as unknown as { Temporal: typeof Temporal }).Temporal;
  const result: Record<string, unknown> = { ...row };

  for (const [name, field] of Object.entries(entity.fields)) {
    if (field.type !== "locatedTimestamp") continue;

    const utcRaw = result[`${name}Utc`];
    const tzRaw = result[`${name}Tz`];

    delete result[`${name}Utc`];
    delete result[`${name}Tz`];

    if (typeof utcRaw !== "string" || typeof tzRaw !== "string") continue;

    const utcIso = pgTimestamptzToInstantIso(utcRaw);
    const localZdt = T.Instant.from(utcIso).toZonedDateTimeISO(tzRaw);
    const at = localZdt.toPlainDateTime().toString();

    result[name] = { at, tz: tzRaw, utc: utcIso };
  }

  return result;
}

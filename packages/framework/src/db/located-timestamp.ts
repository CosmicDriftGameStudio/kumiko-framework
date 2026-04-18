// Auto-Convert für locatedTimestamp-Felder im DB-Layer.
//
// Die zwei Funktionen hier ersetzen den manuellen flattenLocatedPairs/
// rehydrateLocatedTimestamps-Hack den jeder Handler bisher selbst schrieb.
// Sie laufen im createEventStoreExecutor's create/update/list/detail
// (verkabelt im executor.ts) — Feature-Code merkt davon nichts.
//
// Vertrag:
//   Schema-Form (Zod): { at, tz } | { utc, tz }
//   DB-Form: <name>Utc TIMESTAMPTZ + <name>Tz TEXT
//   API-Read-Form: { at, tz, utc }
//
// `at`-Default-Sicht beim Read: Pickup-Ort-lokal (utc projiziert in
// gespeicherter tz). Server kennt User-TZ nicht — User-spezifische
// Anzeige passiert client-seitig aus utc.

import type { EntityDefinition } from "../engine/types";

// PG liefert für TIMESTAMPTZ im mode:"string" das Wire-Format
// "2026-04-15 09:00:00+00". Temporal erwartet ISO-8601 mit "T" und
// entweder "Z" oder "+HH:MM". Mini-Adapter normalisiert.
function pgTimestamptzToInstantIso(pgValue: string): string {
  // Wenn bereits ISO (mit T), pass-through.
  if (pgValue.includes("T")) return pgValue;
  // PG-Format: replace space → T, "+00" am Ende → "Z" für eindeutige UTC.
  return pgValue.replace(" ", "T").replace(/\+00$/, "Z");
}

/**
 * Wandelt locatedTimestamp-Felder (`{ at?, tz, utc? }`) in der Insert/Update-
 * Payload in zwei flache Spalten (`<name>Utc`, `<name>Tz`) um.
 *
 * - Wenn `utc` gegeben ist: utc gewinnt, wird direkt gespeichert.
 * - Wenn nur `at + tz` gegeben: utc wird via Temporal berechnet.
 * - Wenn beide gegeben: utc gewinnt (deterministischer Wert), at wird
 *   ignoriert für die DB. Konsistenz-Check ist Caller-Verantwortung.
 *
 * Idempotent für Felder die bereits flat sind (Server-zu-Server-Imports,
 * Replays). Mutiert nicht — gibt eine flache Kopie zurück.
 */
export function flattenLocatedTimestamps(
  payload: Record<string, unknown>,
  entity: EntityDefinition,
): Record<string, unknown> {
  const T = (globalThis as unknown as { Temporal: typeof Temporal }).Temporal;
  const flat: Record<string, unknown> = { ...payload };

  for (const [name, field] of Object.entries(entity.fields)) {
    if (field.type !== "locatedTimestamp") continue;

    const pair = flat[name] as { at?: string; tz?: string; utc?: string } | undefined;
    if (!pair || typeof pair !== "object") continue;

    delete flat[name];
    if (pair.tz === undefined) continue;

    const tz = pair.tz;
    let utc: string | undefined = pair.utc;
    if (utc === undefined && pair.at !== undefined) {
      utc = T.PlainDateTime.from(pair.at).toZonedDateTime(tz).toInstant().toString();
    }
    if (utc !== undefined) {
      flat[`${name}Utc`] = utc;
      flat[`${name}Tz`] = tz;
    }
  }

  return flat;
}

/**
 * Rekonstruiert locatedTimestamp-Felder aus den zwei flachen DB-Spalten.
 *
 * Liest `<name>Utc` + `<name>Tz` aus der Row, baut `{ at, tz, utc }` als
 * combined Object, und ersetzt die zwei Spalten in der Output-Row.
 *
 * `at` ist immer Pickup-Ort-lokal (utc projiziert in gespeicherter tz).
 * Wer User-Sicht braucht, leitet aus `utc` selbst ab — der Server kennt
 * keine User-TZ.
 *
 * Idempotent für Felder die fehlen oder null sind.
 */
export function rehydrateLocatedTimestamps(
  row: Record<string, unknown>,
  entity: EntityDefinition,
): Record<string, unknown> {
  const T = (globalThis as unknown as { Temporal: typeof Temporal }).Temporal;
  const result: Record<string, unknown> = { ...row };

  for (const [name, field] of Object.entries(entity.fields)) {
    if (field.type !== "locatedTimestamp") continue;

    const utcRaw = result[`${name}Utc`];
    const tz = result[`${name}Tz`];

    delete result[`${name}Utc`];
    delete result[`${name}Tz`];

    if (typeof utcRaw !== "string" || typeof tz !== "string") continue;

    const utcIso = pgTimestamptzToInstantIso(utcRaw);
    const localZdt = T.Instant.from(utcIso).toZonedDateTimeISO(tz);
    const at = localZdt.toPlainDateTime().toString();

    result[name] = { at, tz, utc: utcIso };
  }

  return result;
}

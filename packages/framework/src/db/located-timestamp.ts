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

// Sprint F: <name>Utc-Spalte ist jetzt instant() (siehe dialect.ts) —
// Drizzle gibt direkt Temporal.Instant zurück. Vor Sprint F kam ein PG-
// Wire-Format-String "2026-04-15 09:00:00+00" rein der via String-Massage
// zu ISO-8601 gemacht werden musste. Heute übernimmt der customType die
// Konversion DB↔Instant — diese Funktion ist nur noch defensive Glue für
// Legacy-Code-Pfade die noch Strings durchreichen (z.B. raw SQL).
function toInstant(value: unknown): Temporal.Instant | undefined {
  if (value instanceof Temporal.Instant) return value;
  if (typeof value !== "string") return undefined;
  const iso = value.includes("T") ? value : value.replace(" ", "T").replace(/\+00$/, "Z");
  return Temporal.Instant.from(iso);
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
  const T = Temporal;
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
    const pair = raw as { at?: string; tz?: string; utc?: string }; // @cast-boundary schema-walk

    delete result[name];

    if (pair.tz === undefined) continue;
    const tz = pair.tz;
    // Sprint F: <name>Utc-Spalte ist instant() — Drizzle erwartet
    // Temporal.Instant. Konvertierung pair.utc-string → Instant geht via
    // toInstant() (kennt String + Instant); pair.at + tz → Instant via
    // Temporal-Math.
    const instant: Temporal.Instant | undefined =
      pair.utc !== undefined
        ? toInstant(pair.utc)
        : pair.at !== undefined
          ? T.PlainDateTime.from(pair.at).toZonedDateTime(tz).toInstant()
          : undefined;
    if (instant === undefined) continue;

    result[`${name}Utc`] = instant;
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
  const result: Record<string, unknown> = { ...row };

  for (const [name, field] of Object.entries(entity.fields)) {
    if (field.type !== "locatedTimestamp") continue;

    const utcRaw = result[`${name}Utc`];
    const tzRaw = result[`${name}Tz`];

    delete result[`${name}Utc`];
    delete result[`${name}Tz`];

    if (typeof tzRaw !== "string") continue;
    const utcInstant = toInstant(utcRaw);
    if (utcInstant === undefined) continue;

    const localZdt = utcInstant.toZonedDateTimeISO(tzRaw);
    const at = localZdt.toPlainDateTime().toString();

    result[name] = { at, tz: tzRaw, utc: utcInstant.toString() };
  }

  return result;
}

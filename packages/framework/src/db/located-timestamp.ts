// Automatically converts locatedTimestamp fields in the DB layer.
//
// Contract (see also db/money.ts — the same compound-type pattern):
//   API form:   { at, tz } | { utc, tz }
//   DB form:    <name>Utc TIMESTAMPTZ + <name>Tz TEXT
//   Read form:  { at, tz, utc }
//
// Default `at` view on read: local to the pickup location (`utc` projected into
// the stored `tz`). The server does not know the user's time zone, so
// user-specific display is derived from `utc` on the client.

// Static import, not the ambient global: Bun doesn't expose Temporal on
// globalThis, so this crashed with "Temporal is not defined" outside boot
// paths that install it.
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import type { EntityDefinition } from "../engine/types/index.ts";

// The <name>Utc column uses instant() (see dialect.ts), so Drizzle returns Temporal.Instant.
// Previously, a PostgreSQL wire-format string "2026-04-15 09:00:00+00" had to be
// converted to ISO 8601 through string manipulation. The customType now handles
// DB↔Instant conversion, so this function is only defensive glue for legacy code
// paths that still pass strings (for example, raw SQL).
function toInstant(value: unknown): Temporal.Instant | undefined {
  if (value instanceof Temporal.Instant) return value;
  if (typeof value !== "string") return undefined;
  const iso = value.includes("T") ? value : value.replace(" ", "T").replace(/\+00$/, "Z");
  return Temporal.Instant.from(iso);
}

/**
 * API → DB: flatten locatedTimestamp fields into two flat columns.
 *
 * - `{ at, tz }` (UI form) → `{ <name>Utc, <name>Tz }` (`utc` calculated via Temporal)
 * - `{ utc, tz }` (server form) → `utc` takes precedence
 * - `{ at, tz, utc }` → `utc` takes precedence; `at` is ignored (the caller is
 *   responsible for the consistency check)
 *
 * Pure — does not mutate.
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
    // The <name>Utc column uses instant(); Drizzle expects
    // Temporal.Instant. Conversion from pair.utc string → Instant goes through
    // toInstant() (which handles strings and Instant values); pair.at + tz →
    // Instant uses Temporal math.
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

/** Shape of a single rehydrated locatedTimestamp field. `at` is the wall clock in `tz`
 *  (no offset), `utc` the ISO instant string; both are strings, not Temporal values. */
export type LocatedTimestampRead = {
  readonly at: string;
  readonly tz: string;
  readonly utc: string;
};

/**
 * DB → API: rehydrate two flat columns into combined { at, tz, utc }.
 *
 * `at` is always the wall-clock time in the stored `tz` (local to the pickup
 * location). To obtain a user-specific view, derive it from `utc` yourself —
 * the server does not know the user's time zone.
 *
 * Pure — does not mutate.
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

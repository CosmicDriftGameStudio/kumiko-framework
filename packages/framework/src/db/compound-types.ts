// Compound-Type Pipeline für den Executor.
//
// Ein Compound-Type ist ein Field das aus EINEM API-Object und MEHREREN
// DB-Spalten besteht. Beispiele:
//   - locatedTimestamp: { at, tz, utc } ↔ <name>Utc + <name>Tz
//   - money: { amount, currency } ↔ <name> + <name>Currency
//   - (kommt) address: { street, zip, city } ↔ <name>Street + <name>Zip + <name>City
//
// Statt jeden Helper im Executor an 4 Stellen verschachtelt aufzurufen,
// pipeline-iert diese Funktion alle Compound-Type-Konvertierungen in
// einem Pass. Beim Hinzufügen eines neuen Compound-Types nur EINE Stelle
// erweitern (das Array hier), nicht alle Executor-Aufrufe.

import type { EntityDefinition } from "../engine/types";
import { flattenLocatedTimestamp, rehydrateLocatedTimestamp } from "./located-timestamp";
import { flattenMoney, rehydrateMoney } from "./money";

type Converter = (
  payload: Record<string, unknown>,
  entity: EntityDefinition,
) => Record<string, unknown>;

// Reihenfolge ist egal solange die Konverter sich nicht gegenseitig
// überlappen (z.B. money darf nicht ein Feld berühren das locatedTimestamp
// schon erzeugt hat). Aktuell überlappen sie nicht — types sind disjunkt.
const FLATTENERS: readonly Converter[] = [flattenLocatedTimestamp, flattenMoney];
const REHYDRATORS: readonly Converter[] = [rehydrateLocatedTimestamp, rehydrateMoney];

/**
 * API-Form (combined) → DB-Form (flat). Wird vor jedem Insert/Update aufgerufen.
 */
export function flattenCompoundTypes(
  payload: Record<string, unknown>,
  entity: EntityDefinition,
): Record<string, unknown> {
  return FLATTENERS.reduce((acc, fn) => fn(acc, entity), payload);
}

/**
 * DB-Form (flat) → API-Form (combined). Wird nach jedem Read aufgerufen.
 */
export function rehydrateCompoundTypes(
  row: Record<string, unknown>,
  entity: EntityDefinition,
): Record<string, unknown> {
  return REHYDRATORS.reduce((acc, fn) => fn(acc, entity), row);
}

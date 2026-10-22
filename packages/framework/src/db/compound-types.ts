// Compound-type pipeline for the executor.
//
// A compound type is a field represented by ONE API object and MULTIPLE
// DB columns. Examples:
//   - locatedTimestamp: { at, tz, utc } ↔ <name>Utc + <name>Tz
//   - money: { amount, currency } ↔ <name> + <name>Currency
//   - (upcoming) address: { street, zip, city } ↔ <name>Street + <name>Zip + <name>City
//
// Instead of nesting every helper in the executor at four different points,
// this function pipelines all compound-type conversions in one pass. Adding
// a new compound type requires extending only ONE place (this array), rather
// than every executor call.

import type { EntityDefinition } from "../engine/types/index.ts";
import { flattenLocatedTimestamp, rehydrateLocatedTimestamp } from "./located-timestamp.ts";
import { flattenMoney, rehydrateMoney } from "./money.ts";

type Converter = (
  payload: Record<string, unknown>,
  entity: EntityDefinition,
) => Record<string, unknown>;

// Order is irrelevant as long as the converters do not overlap (for example,
// money must not touch a field already produced by locatedTimestamp). They do
// not currently overlap—types are disjoint.
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
 * DB form (flat) → API form (combined). Called after every read.
 */
export function rehydrateCompoundTypes(
  row: Record<string, unknown>,
  entity: EntityDefinition,
): Record<string, unknown> {
  return REHYDRATORS.reduce((acc, fn) => fn(acc, entity), row);
}

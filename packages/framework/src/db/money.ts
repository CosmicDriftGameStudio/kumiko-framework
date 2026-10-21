// Automatically convert money fields in the DB layer.
//
// Contract (see also db/located-timestamp.ts — the same compound-type pattern):
//   API form:   { amount, currency } | number — amount in MAJOR units (56799.16 EUR)
//   DB form:    <name> BIGINT (minor units, e.g. cents) + <name>Currency TEXT
//   Read form:  { amount, currency, amountScaled } — amount in MAJOR units again,
//               amountScaled sits alongside as the exact integer value in
//               MINOR_UNIT_SCALE units for callers that need scale-exact
//               comparisons (e.g. invoice sums) instead of round-tripping the
//               float amount through /100·*100.
//                `amountMinor` stays as a @deprecated alias of the same
//               value until the remaining consumers
//               (renderer/web/primitives/index.tsx,
//               renderer/components/render-field.tsx) migrate off the old name.
//
// table-builder.ts's moneyAmount column has always documented BIGINT as
// "the integer minor unit" — this file used to just pass the API amount
// through unconverted, silently violating that contract: a caller doing
// the ergonomic thing (passing 56799.16) got a float into a bigint column
// (driver error) or, worse, an integer major-unit amount (56799) got
// stored as if it were already minor units — 100× too small on read back.
// MINOR_UNIT_SCALE fixes that at the boundary so every caller can just
// pass/receive ordinary decimal amounts; DB storage stays exact-integer
// cents (no float drift in SUM()/aggregate queries).
//
// Permissive insert: a primitive number is accepted as amount (legacy from
// pre-Stufe-3 samples). Currency then falls back to entity.defaultCurrency
// (or DEFAULT_CURRENCIES[0] = "EUR" as the framework fallback).
//
// Unlike locatedTimestamp, we retain the field name `<name>` as the
// amount column (legacy DB convention for money — `SUM(buying_price)` remains
// idiomatic). `<name>Currency` is the additional column.

import { MINOR_UNIT_SCALE, toMinorUnits } from "../engine/minor-units.ts";
import type { EntityDefinition } from "../engine/types/index.ts";
import { DEFAULT_CURRENCIES } from "../engine/types/index.ts";

const FRAMEWORK_DEFAULT_CURRENCY = DEFAULT_CURRENCIES[0]; // "EUR"

export { toMinorUnits };

function toMajorUnits(amountScaled: number): number {
  return amountScaled / MINOR_UNIT_SCALE;
}

// One money field's write payload — `{ amount, currency }` or a bare number
// (both MAJOR units, see file header) — reduced to minor units. This is the
// counterpart a write-handler needs when comparing a top-level money field
// against an `embeddedSubFieldToZod` list-row sum: rows are minor-unit
// integers by convention (currency lives on the head aggregate, not the
// row), so the two can only be compared once the sibling amount has been
// scaled the same way. `applyTotalsMatchRefinements` (schema-builder.ts)
// uses this internally for `EmbeddedFieldDef.totalsMatch`; exported so a
// custom write-handler doing its own total check doesn't have to re-derive
// this unwrap-and-scale step by hand. A hand-rolled comparison of a raw
// `{amount}` against a raw minor-unit row sum is exactly what silently fails
// 100× off.
export function moneyPayloadToMinorUnits(raw: unknown): number | undefined {
  if (typeof raw === "number") return toMinorUnits(raw);
  if (typeof raw === "object" && raw !== null && "amount" in raw) {
    const amount = raw.amount;
    if (typeof amount === "number") return toMinorUnits(amount);
  }
  return undefined;
}

/**
 * Flatten money fields into two API-to-DB columns.
 *
 * - `{ amount, currency }` → `{ <name>: amount, <name>Currency: currency }`
 * - `number` (legacy) → `{ <name>: number, <name>Currency: defaultCurrency }`
 *
 * Pure — does not mutate its input.
 */
interface MoneyPair {
  amount: number;
  currency?: string;
}

export function flattenMoney(
  payload: Record<string, unknown>,
  entity: EntityDefinition,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...payload };
  const fallbackCurrency = entity.defaultCurrency ?? FRAMEWORK_DEFAULT_CURRENCY;

  for (const [name, field] of Object.entries(entity.fields)) {
    if (field.type !== "money") continue;

    const raw = result[name];
    if (raw === undefined || raw === null) continue;

    let amount: number;
    let currency: string;

    if (
      typeof raw === "object" &&
      raw !== null &&
      "amount" in raw &&
      typeof (raw as MoneyPair).amount === "number" // @cast-boundary schema-walk
    ) {
      const pair = raw as MoneyPair; // @cast-boundary schema-walk
      amount = pair.amount;
      currency = pair.currency ?? fallbackCurrency;
    } else if (typeof raw === "number") {
      amount = raw;
      // An explicit currency key in the payload overrides the default fallback.
      const explicitCurrency = result[`${name}Currency`];
      currency = typeof explicitCurrency === "string" ? explicitCurrency : fallbackCurrency;
    } else {
      throw new Error(
        `flattenMoney: field "${name}" expects { amount, currency } object or number, got ${typeof raw}`,
      );
    }

    delete result[name];
    result[name] = toMinorUnits(amount);
    result[`${name}Currency`] = currency;
  }

  return result;
}

/** Shape of a single rehydrated money field — {amount major, currency,
 *  amountScaled exact integer value in MINOR_UNIT_SCALE units}. Exported so
 *  consumers type their own copy against this instead of re-declaring the
 *  shape by hand. */
export type MoneyRead = {
  readonly amount: number;
  readonly currency: string;
  readonly amountScaled: number;
  /**
   * @deprecated Removed in 0.390.0. Use `amountScaled` — this name implies ISO-4217 minor units
   * (cents), which is wrong once a currency needing a different scale than
   * the current flat MINOR_UNIT_SCALE=100 lands (e.g. JPY, 0 decimals).
   * Alias of `amountScaled`, kept until the consumers migrate off it.
   */
  readonly amountMinor: number;
};

/**
 * Rehydrate two flat DB columns into a combined `{ amount, currency }` value.
 *
 * Throws loudly for corrupt DB values (for example, a string that cannot be
 * converted to a number), because silent data loss would hide a bug. A
 * NULL/undefined amount removes the field from the output.
 *
 * Pure — does not mutate its input.
 */
export function rehydrateMoney(
  row: Record<string, unknown>,
  entity: EntityDefinition,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...row };
  const fallbackCurrency = entity.defaultCurrency ?? FRAMEWORK_DEFAULT_CURRENCY;

  for (const [name, field] of Object.entries(entity.fields)) {
    if (field.type !== "money") continue;

    const amountRaw = result[name];
    const currencyRaw = result[`${name}Currency`];

    delete result[`${name}Currency`];

    if (amountRaw === null || amountRaw === undefined) {
      delete result[name];
      continue;
    }

    let amountScaled: number;
    if (typeof amountRaw === "number") {
      amountScaled = amountRaw;
    } else if (typeof amountRaw === "bigint") {
      amountScaled = Number(amountRaw);
      if (!Number.isSafeInteger(amountScaled)) {
        throw new Error(`rehydrateMoney: field "${name}" bigint amount is not a safe integer`);
      }
    } else if (typeof amountRaw === "string" && amountRaw !== "") {
      // The PG driver sometimes returns BIGINT as a string (when it exceeds the
      // safe integer range of 2^53).
      amountScaled = Number(amountRaw);
      if (!Number.isSafeInteger(amountScaled)) {
        throw new Error(
          `rehydrateMoney: field "${name}" amount string "${amountRaw}" is not a safe integer — DB corruption?`,
        );
      }
    } else {
      throw new Error(
        `rehydrateMoney: field "${name}" amount has unexpected type ${typeof amountRaw}`,
      );
    }

    const currency =
      typeof currencyRaw === "string" && currencyRaw !== "" ? currencyRaw : fallbackCurrency;

    // amountMinor: deprecated alias, same value as amountScaled — see MoneyRead.
    result[name] = {
      amount: toMajorUnits(amountScaled),
      currency,
      amountScaled,
      amountMinor: amountScaled,
    };
  }

  return result;
}

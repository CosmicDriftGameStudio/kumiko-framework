// Money fields in the DB layer.
//
// Invariant: API payload, event and DB carry the same integer amount in the
// currency's minor unit — no conversion happens here. The column holds BIGINT
// plus a sibling `<name>Currency` TEXT column (same compound pattern as
// db/located-timestamp.ts).

import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { DEFAULT_CURRENCIES } from "../engine/field-helpers.ts";

export const FRAMEWORK_DEFAULT_CURRENCY = DEFAULT_CURRENCIES[0]; // "EUR"

/**
 * Flatten money fields into two API-to-DB columns.
 *
 * `{ amount, currency }` → `{ <name>: amount, <name>Currency: currency }`
 * (currency falls back to the entity default). Throws on a bare number or a
 * non-integer amount. Pure — does not mutate its input.
 */
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

    if (!isPlainObject(raw) || typeof raw["amount"] !== "number") {
      throw new Error(
        `money field "${name}": expected { amount, currency } with amount in minor units`,
      );
    }
    const amount = raw["amount"];
    const currencyRaw = raw["currency"];
    const currency = typeof currencyRaw === "string" ? currencyRaw : fallbackCurrency;
    if (!Number.isSafeInteger(amount)) {
      throw new Error(
        `money field "${name}": amount must be an integer in minor units of ${currency} (got ${String(amount)})`,
      );
    }

    result[name] = amount;
    result[`${name}Currency`] = currency;
  }

  return result;
}

/** Shape of a single rehydrated money field — `{ amount (integer, minor units), currency }`.
 *  Exported so consumers type their own copy against this instead of re-declaring the
 *  shape by hand. */
export type MoneyRead = {
  readonly amount: number;
  readonly currency: string;
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

    result[name] = readMoney(name, amountRaw, currencyRaw, fallbackCurrency);
  }

  return result;
}

/** One money value from its raw amount/currency columns; shared with SQL derived money so both
 *  produce the identical read shape. Throws on a corrupt amount. */
export function readMoney(
  name: string,
  amountRaw: unknown,
  currencyRaw: unknown,
  fallbackCurrency: string,
): MoneyRead {
  let amount: number;
  if (typeof amountRaw === "number") {
    amount = amountRaw;
  } else if (typeof amountRaw === "bigint") {
    amount = Number(amountRaw);
    if (!Number.isSafeInteger(amount)) {
      throw new Error(`rehydrateMoney: field "${name}" bigint amount is not a safe integer`);
    }
  } else if (typeof amountRaw === "string" && amountRaw !== "") {
    // The PG driver sometimes returns BIGINT as a string (when it exceeds the
    // safe integer range of 2^53).
    amount = Number(amountRaw);
    if (!Number.isSafeInteger(amount)) {
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

  return { amount, currency };
}

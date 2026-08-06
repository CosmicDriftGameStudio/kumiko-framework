// Auto-Convert für money-Felder im DB-Layer.
//
// Vertrag (siehe auch db/located-timestamp.ts — gleicher Compound-Type-Pattern):
//   API-Form:    { amount, currency } | number — amount in MAJOR units (56799.16 EUR)
//   DB-Form:     <name> BIGINT (minor units, e.g. cents) + <name>Currency TEXT
//   Read-Form:   { amount, currency, amountMinor } — amount in MAJOR units again,
//                amountMinor sits alongside as exact integer cents (fw#1830) for
//                callers that need cent-exact comparisons (e.g. invoice sums)
//                instead of round-tripping the float amount through /100·*100.
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
// Permissiv-Insert: primitive number wird als amount akzeptiert (Legacy aus
// pre-Stufe-3-Samples). Currency fällt dann auf entity.defaultCurrency
// zurück (oder DEFAULT_CURRENCIES[0] = "EUR" als Framework-Fallback).
//
// Anders als locatedTimestamp behalten wir den Field-Namen `<name>` als
// amount-Spalte (Legacy DB-Convention für Money — `SUM(buying_price)` bleibt
// idiomatisch). `<name>Currency` ist die zusätzliche Spalte.

import type { EntityDefinition } from "../engine/types";
import { DEFAULT_CURRENCIES } from "../engine/types";

const FRAMEWORK_DEFAULT_CURRENCY = DEFAULT_CURRENCIES[0]; // "EUR"

// 2 decimal places (cents) — covers every currently-supported currency
// (EUR/USD/GBP/...). No ISO-4217 minor-unit table yet (JPY=0, BHD=3) —
// upgrade path once a currency needing a different scale actually lands.
const MINOR_UNIT_SCALE = 100;

export function toMinorUnits(amount: number): number {
  return Math.round(amount * MINOR_UNIT_SCALE);
}

function toMajorUnits(amountMinor: number): number {
  return amountMinor / MINOR_UNIT_SCALE;
}

/**
 * API → DB: money-Felder zu zwei flachen Spalten flatten.
 *
 * - `{ amount, currency }` → `{ <name>: amount, <name>Currency: currency }`
 * - `number` (legacy) → `{ <name>: number, <name>Currency: defaultCurrency }`
 *
 * Pure — mutiert nicht.
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
      // Expliziter currency-key im Payload überschreibt den Default-Fallback.
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

/**
 * DB → API: zwei flache Spalten zu combined { amount, currency } rehydraten.
 *
 * Wirft loud bei korrupter DB-Form (string das nicht zur Zahl wird) — silent
 * data-loss wäre Bug-Vektor. NULL/undefined amount → field aus Output entfernt.
 *
 * Pure — mutiert nicht.
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

    let amountMinor: number;
    if (typeof amountRaw === "number") {
      amountMinor = amountRaw;
    } else if (typeof amountRaw === "bigint") {
      amountMinor = Number(amountRaw);
      if (Number.isNaN(amountMinor)) {
        throw new Error(`rehydrateMoney: field "${name}" bigint amount is not a number`);
      }
    } else if (typeof amountRaw === "string" && amountRaw !== "") {
      // PG-driver liefert BIGINT manchmal als String (>2^53 sicher).
      amountMinor = Number(amountRaw);
      if (Number.isNaN(amountMinor)) {
        throw new Error(
          `rehydrateMoney: field "${name}" amount string "${amountRaw}" is not a number — DB corruption?`,
        );
      }
    } else {
      throw new Error(
        `rehydrateMoney: field "${name}" amount has unexpected type ${typeof amountRaw}`,
      );
    }

    const currency =
      typeof currencyRaw === "string" && currencyRaw !== "" ? currencyRaw : fallbackCurrency;

    result[name] = { amount: toMajorUnits(amountMinor), currency, amountMinor };
  }

  return result;
}

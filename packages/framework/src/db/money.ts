// Auto-Convert für money-Felder im DB-Layer.
//
// Vertrag (siehe auch db/located-timestamp.ts — gleicher Compound-Type-Pattern):
//   API-Form:    { amount, currency } | number — amount in MAJOR units (56799.16 EUR)
//   DB-Form:     <name> BIGINT (minor units, e.g. cents) + <name>Currency TEXT
//   Read-Form:   { amount, currency, amountScaled } — amount in MAJOR units again,
//                amountScaled sits alongside as the exact integer value in
//                MINOR_UNIT_SCALE units (fw#1830) for callers that need
//                scale-exact comparisons (e.g. invoice sums) instead of
//                round-tripping the float amount through /100·*100.
//                `amountMinor` stays as a @deprecated alias of the same
//                value until #1976/4 and #1976/5 migrate their remaining
//                consumers (renderer-web/primitives/index.tsx,
//                renderer/components/render-field.tsx) off the old name.
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
// this unwrap-and-scale step by hand (kumiko-framework#1972 — a hand-rolled
// comparison of a raw `{amount}` against a raw minor-unit row sum is exactly
// what silently fails 100x off).
export function moneyPayloadToMinorUnits(raw: unknown): number | undefined {
  if (typeof raw === "number") return toMinorUnits(raw);
  if (typeof raw === "object" && raw !== null && "amount" in raw) {
    const amount = (raw as { amount: unknown }).amount;
    if (typeof amount === "number") return toMinorUnits(amount);
  }
  return undefined;
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

/** Shape of a single rehydrated money field — {amount major, currency,
 *  amountScaled exact integer value in MINOR_UNIT_SCALE units}. Exported so
 *  consumers type their own copy against this instead of re-declaring the
 *  shape by hand. */
export type MoneyRead = {
  readonly amount: number;
  readonly currency: string;
  readonly amountScaled: number;
  /**
   * @deprecated Use `amountScaled` — this name implies ISO-4217 minor units
   * (cents), which is wrong once a currency needing a different scale than
   * the current flat MINOR_UNIT_SCALE=100 lands (e.g. JPY, 0 decimals).
   * Alias of `amountScaled`, kept until #1976/4 and #1976/5 migrate their
   * consumers off it.
   */
  readonly amountMinor: number;
};

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

    let amountScaled: number;
    if (typeof amountRaw === "number") {
      amountScaled = amountRaw;
    } else if (typeof amountRaw === "bigint") {
      amountScaled = Number(amountRaw);
      if (!Number.isSafeInteger(amountScaled)) {
        throw new Error(`rehydrateMoney: field "${name}" bigint amount is not a safe integer`);
      }
    } else if (typeof amountRaw === "string" && amountRaw !== "") {
      // PG-driver liefert BIGINT manchmal als String (>2^53 sicher).
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

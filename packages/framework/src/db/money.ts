// Auto-Convert für money-Felder im DB-Layer.
//
// Vertrag (siehe auch db/located-timestamp.ts — gleicher Compound-Type-Pattern):
//   API-Form:    { amount, currency } | number (permissiv für Legacy)
//   DB-Form:     <name> BIGINT + <name>Currency TEXT
//   Read-Form:   { amount, currency }
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
      typeof (raw as MoneyPair).amount === "number"
    ) {
      const pair = raw as MoneyPair;
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
    result[name] = amount;
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

    let amount: number;
    if (typeof amountRaw === "number") {
      amount = amountRaw;
    } else if (typeof amountRaw === "string" && amountRaw !== "") {
      // PG-driver liefert BIGINT manchmal als String (>2^53 sicher).
      amount = Number(amountRaw);
      if (Number.isNaN(amount)) {
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

    result[name] = { amount, currency };
  }

  return result;
}

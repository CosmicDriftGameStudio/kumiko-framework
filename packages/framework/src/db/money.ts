// Auto-Convert für money-Felder im DB-Layer.
//
// Parallel zu located-timestamp.ts: ein API-Object combined ↔ zwei flache
// DB-Spalten. Feature-Code schreibt `{ buyingPrice: { amount, currency } }`,
// liest dasselbe combined-Form, Framework macht alles dazwischen transparent.
//
// Vertrag:
//   Schema-Form (Zod): { amount, currency } | number (permissiv)
//   DB-Form: <name> BIGINT + <name>Currency TEXT
//   API-Read-Form: { amount, currency }
//
// Permissiv-Insert: primitive number wird akzeptiert (Legacy-Pattern aus
// pre-Stufe-3-Samples). Currency fällt dann auf entity.defaultCurrency
// zurück (oder "EUR" als Framework-Default). Beim Read kommt immer
// combined { amount, currency } zurück — egal wie eingegeben.

import type { EntityDefinition } from "../engine/types";

const FRAMEWORK_DEFAULT_CURRENCY = "EUR";

/**
 * Wandelt money-Felder im Insert/Update-Payload in zwei flache Spalten.
 * - `{ amount, currency }` → `{ <name>: amount, <name>Currency: currency }`
 * - `number` (legacy) → `{ <name>: number, <name>Currency: defaultCurrency }`
 *   (entity.defaultCurrency oder "EUR" als Fallback)
 *
 * Mutiert nicht — gibt eine flache Kopie zurück. Idempotent für Felder
 * die bereits flat sind (Pass-Through).
 */
export function flattenMoney(
  payload: Record<string, unknown>,
  entity: EntityDefinition,
): Record<string, unknown> {
  const flat: Record<string, unknown> = { ...payload };
  const fallbackCurrency = entity.defaultCurrency ?? FRAMEWORK_DEFAULT_CURRENCY;

  for (const [name, field] of Object.entries(entity.fields)) {
    if (field.type !== "money") continue;

    const raw = flat[name];
    if (raw === undefined || raw === null) continue;

    // Combined { amount, currency } → flat
    if (typeof raw === "object" && "amount" in raw) {
      const pair = raw as { amount: number; currency?: string };
      flat[name] = pair.amount;
      flat[`${name}Currency`] = pair.currency ?? fallbackCurrency;
      continue;
    }
    // Primitive number (legacy) → keep amount, default-currency setzen
    if (typeof raw === "number") {
      // amount bleibt wie es ist; Currency nur setzen wenn nicht vorhanden,
      // damit ein expliziter `<name>Currency` im Payload nicht überschrieben wird
      if (flat[`${name}Currency`] === undefined) {
        flat[`${name}Currency`] = fallbackCurrency;
      }
    }
    // Andere Formen (z.B. null, undefined) lassen wir wie sie sind — der
    // Insert/Update-Layer entscheidet selbst was er damit tut.
  }

  return flat;
}

/**
 * Rekonstruiert money-Felder aus den zwei flachen DB-Spalten.
 *
 * Liest `<name>` (BIGINT) + `<name>Currency` (TEXT) und baut combined
 * `{ amount, currency }`. Die zwei flachen Spalten verschwinden aus der
 * Output-Row.
 *
 * Idempotent für Felder die fehlen oder null sind.
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

    // PG liefert BIGINT als string in einigen Drivers — coerce.
    let amount: number | null = null;
    if (typeof amountRaw === "number") amount = amountRaw;
    else if (typeof amountRaw === "string" && amountRaw !== "") amount = Number(amountRaw);
    else if (amountRaw === null || amountRaw === undefined) {
      // Money-Feld leer in DB — entferne aus Output (kein combined Object
      // mit null amount), damit Field-Access + Optionalitäts-Semantik klar
      // bleibt.
      delete result[name];
      continue;
    }

    if (amount === null || Number.isNaN(amount)) {
      delete result[name];
      continue;
    }

    const currency =
      typeof currencyRaw === "string" && currencyRaw !== "" ? currencyRaw : fallbackCurrency;

    result[name] = { amount, currency };
  }

  return result;
}

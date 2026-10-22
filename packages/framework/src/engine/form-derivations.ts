import type { FormFieldDefinition } from "@cosmicdrift/kumiko-types/fields";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import {
  computeDerivedCellValue,
  roundDerivedCellValue,
  withDerivedCells,
} from "./embedded-derived.ts";
import { MINOR_UNIT_SCALE, toMinorUnits } from "./minor-units.ts";
import type { FieldDefinition } from "./types/fields.ts";
import type { FormFieldDerivation } from "./types/screen.ts";

export type FormDerivationScreen = {
  readonly fields: Readonly<Record<string, FormFieldDefinition>>;
  readonly derive?: Readonly<Record<string, FormFieldDerivation>>;
};

type MoneyOperand = { readonly minor: number; readonly currency: string | undefined };

function readMoneyOperand(raw: unknown): MoneyOperand | undefined {
  if (typeof raw === "number") return { minor: toMinorUnits(raw), currency: undefined };
  if (!isPlainObject(raw) || typeof raw["amount"] !== "number") return undefined;
  const currency = raw["currency"];
  return {
    minor: toMinorUnits(raw["amount"]),
    currency: typeof currency === "string" && currency !== "" ? currency : undefined,
  };
}

function readOperand(
  values: Readonly<Record<string, unknown>>,
  fields: Readonly<Record<string, FormFieldDefinition>>,
  name: string,
): { value: number | undefined; currency: string | undefined } {
  const raw = values[name];
  if (fields[name]?.type === "money") {
    const money = readMoneyOperand(raw);
    return { value: money?.minor, currency: money?.currency };
  }
  return { value: typeof raw === "number" ? raw : undefined, currency: undefined };
}

function dependenciesOf(derivation: FormFieldDerivation): readonly string[] {
  if (derivation.op === "listSum") {
    return derivation.whenEmpty === undefined ? [] : derivation.whenEmpty.from;
  }
  return derivation.from;
}

/** Targets ordered so every derived source is computed before its reader. */
export function orderFormDerivations(
  derive: Readonly<Record<string, FormFieldDerivation>>,
): readonly string[] {
  const ordered: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (name: string, path: readonly string[]): void => {
    const derivation = derive[name];
    // skip: plain input field, nothing to order
    if (derivation === undefined) return;
    const status = state.get(name);
    // skip: already ordered via another path
    if (status === "done") return;
    if (status === "visiting") {
      throw new Error(`Form derivation cycle: ${[...path, name].join(" -> ")}`);
    }
    state.set(name, "visiting");
    for (const dependency of dependenciesOf(derivation)) visit(dependency, [...path, name]);
    state.set(name, "done");
    ordered.push(name);
  };
  for (const name of Object.keys(derive)) visit(name, []);
  return ordered;
}

function isNonEmptyList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value) && value.length > 0;
}

/** True when `field` is a `listSum` without `whenEmpty` whose list has no
 *  rows: the sum has nothing to add up, so the user types the value. */
export function isFormDerivationInputMode(
  screen: FormDerivationScreen,
  values: unknown,
  field: string,
): boolean {
  const derivation = screen.derive?.[field];
  if (derivation === undefined || derivation.op !== "listSum") return false;
  if (derivation.whenEmpty !== undefined) return false;
  return !isPlainObject(values) || !isNonEmptyList(values[derivation.list]);
}

/** True when `field` is only read as a `whenEmpty` operand of `listSum`
 *  derivations whose lists all have rows: nothing reads it, so it is locked
 *  rather than inviting an input that is silently dropped. */
export function isUnusedFallbackOperand(
  screen: FormDerivationScreen,
  values: unknown,
  field: string,
): boolean {
  const derive = screen.derive;
  if (derive === undefined || derive[field] !== undefined) return false;
  let usedAsFallback = false;
  for (const derivation of Object.values(derive)) {
    if (derivation.op !== "listSum") {
      if (derivation.from.includes(field)) return false;
      continue;
    }
    if (derivation.whenEmpty?.from.includes(field) !== true) continue;
    if (!isPlainObject(values) || !isNonEmptyList(values[derivation.list])) return false;
    usedAsFallback = true;
  }
  return usedAsFallback;
}

function sumListCell(
  rows: readonly unknown[],
  listField: FieldDefinition | undefined,
  cell: string,
): number {
  const embedded = listField?.type === "embedded" ? listField : undefined;
  let sum = 0;
  for (const rawRow of rows) {
    // Recompute the row's derived cells so a manipulated row value can't leak into the head.
    const row =
      embedded?.derived === undefined
        ? rawRow
        : withDerivedCells(rawRow, embedded.derived, embedded.schema);
    if (isPlainObject(row) && typeof row[cell] === "number") sum += row[cell];
  }
  return sum;
}

function targetCurrency(
  field: FormFieldDefinition,
  current: unknown,
  sourceCurrency: string | undefined,
): string | undefined {
  // The client value is last: it must never override what the field or its sources dictate.
  if (field.type === "money" && field.currency.kind === "literal") return field.currency.code;
  if (sourceCurrency !== undefined) return sourceCurrency;
  if (
    isPlainObject(current) &&
    typeof current["currency"] === "string" &&
    current["currency"] !== ""
  ) {
    return current["currency"];
  }
  return undefined;
}

function computeOrdinary(
  derivation: Extract<FormFieldDerivation, { from: unknown }>,
  values: Record<string, unknown>,
  fields: FormDerivationScreen["fields"],
): { computed: number | undefined; sourceCurrency: string | undefined } {
  const operands = derivation.from.map((name) => readOperand(values, fields, name));
  const currencies = new Set(operands.flatMap((operand) => operand.currency ?? []));
  const sourceCurrency = currencies.values().next().value;
  // Operands in different currencies have no meaningful sum.
  if (currencies.size > 1) return { computed: undefined, sourceCurrency };
  return {
    computed: computeDerivedCellValue(
      derivation.op,
      operands.map((operand) => operand.value),
    ),
    sourceCurrency,
  };
}

/** Recomputes every derived head field of an action form from its inputs.
 *  Pure and client-safe: the renderer runs it live, the server runs it
 *  again (`withFormDerivations`) and overwrites whatever the client sent.
 *  Money operands are converted to minor units for the arithmetic and money
 *  targets are written back as `{ amount, currency }` in major units. */
export function applyFormDerivations(values: unknown, screen: FormDerivationScreen): unknown {
  if (!isPlainObject(values)) return values;
  const derive = screen.derive;
  if (derive === undefined) return values;
  const result: Record<string, unknown> = { ...values };

  for (const target of orderFormDerivations(derive)) {
    const derivation = derive[target];
    const targetField = screen.fields[target];
    if (derivation === undefined || targetField === undefined) continue;

    let computed: number | undefined;
    let sourceCurrency: string | undefined;
    let ordinary: Extract<FormFieldDerivation, { from: unknown }> | undefined;

    if (derivation.op === "listSum") {
      const rows = result[derivation.list];
      if (isNonEmptyList(rows)) {
        computed = sumListCell(rows, screen.fields[derivation.list], derivation.cell);
      } else if (derivation.whenEmpty === undefined) {
        continue;
      } else {
        ordinary = derivation.whenEmpty;
      }
    } else {
      ordinary = derivation;
    }

    if (ordinary !== undefined) {
      ({ computed, sourceCurrency } = computeOrdinary(ordinary, result, screen.fields));
    }

    if (computed === undefined) {
      delete result[target];
      continue;
    }
    if (targetField.type === "money") {
      const minor = roundDerivedCellValue(computed, { type: "money" });
      const currency = targetCurrency(targetField, result[target], sourceCurrency);
      result[target] =
        currency === undefined
          ? { amount: minor / MINOR_UNIT_SCALE }
          : { amount: minor / MINOR_UNIT_SCALE, currency };
    } else if (targetField.type === "decimal") {
      result[target] = roundDerivedCellValue(computed, targetField);
    } else {
      result[target] = computed;
    }
  }
  return result;
}

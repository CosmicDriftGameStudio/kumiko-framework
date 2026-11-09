import type { ReactNode } from "react";
import {
  currencyDecimals,
  type EditFieldViewModel,
  formatMoney,
  moneyAmountToMinor,
  resolveSafeMoneyLocale,
} from "../headless/index.ts";
import { useOptionalLocale } from "../i18n.tsx";
import { usePrimitives } from "../primitives.tsx";
import { choiceChipClass } from "./choice-chip-class.ts";
import { moneyPayload, resolveMoneyCurrency } from "./render-field-values.ts";

function chipValues(row: Readonly<Record<string, unknown>>, from: string): readonly number[] {
  const raw = row[from];
  return Array.isArray(raw) ? raw.filter((v): v is number => typeof v === "number") : [];
}

// Chip values are major units, like the text on the chip.
function chipText(
  field: EditFieldViewModel,
  value: number,
  currency: string,
  locale: string | undefined,
): string {
  if (field.type === "money") {
    const decimals = currencyDecimals(currency);
    return formatMoney(
      Math.round(value * 10 ** decimals),
      currency,
      locale,
      Number.isInteger(value) ? 0 : decimals,
    );
  }
  const text = new Intl.NumberFormat(resolveSafeMoneyLocale(locale)).format(value);
  return typeof field.suffix === "string" ? `${text} ${field.suffix}` : text;
}

// The form holds a money value as { amount (major units), currency }.
function currentMajorValue(field: EditFieldViewModel): number | undefined {
  const { value } = field;
  if (field.type !== "money") return typeof value === "number" ? value : undefined;
  if (typeof value !== "object" || value === null || !("amount" in value)) return undefined;
  return typeof value.amount === "number" ? value.amount : undefined;
}

// A money field stores {amount, currency}, a number field the bare number.
export function ValueChipsControl({
  field,
  from,
  row,
  onChange,
  input,
}: {
  readonly field: EditFieldViewModel;
  readonly from: string;
  readonly row: Readonly<Record<string, unknown>>;
  readonly onChange: (value: unknown) => void;
  readonly input: ReactNode;
}): ReactNode {
  const { Button, Grid } = usePrimitives();
  const locale = useOptionalLocale();
  const values = chipValues(row, from);
  const currency = resolveMoneyCurrency(field.value, field.currency);
  const current = currentMajorValue(field);
  const pick = (value: number): void => {
    if (field.type !== "money") {
      onChange(value);
      return;
    }
    onChange(moneyPayload(moneyAmountToMinor(value, currency), currency));
  };
  return (
    <>
      {input}
      {values.length > 0 && (
        <Grid columns="auto" tight testId={`field-value-chips-${field.field}`}>
          {values.map((value) => {
            const selected = value === current;
            return (
              <Button
                key={value}
                variant="secondary"
                size="sm"
                className={choiceChipClass(selected)}
                pressed={selected}
                disabled={field.readOnly}
                testId={`field-value-chip-${field.field}-${value}`}
                onClick={() => pick(value)}
              >
                {selected ? "✓ " : ""}
                {chipText(field, value, currency, locale)}
              </Button>
            );
          })}
        </Grid>
      )}
    </>
  );
}

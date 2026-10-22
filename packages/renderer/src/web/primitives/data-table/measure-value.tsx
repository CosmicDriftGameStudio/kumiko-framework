import { isListAggregateCurrencyAmounts } from "@cosmicdrift/kumiko-types/list-aggregate-types";
import type { ReactNode } from "react";
import type { DataTableMeasure } from "../../../data-table-aggregate-types.ts";
import type { ListColumnViewModel } from "../../../headless/index.ts";
import { useOptionalLocale, useOptionalTranslation } from "../../../index.ts";
import { DataTableCell } from "../data-table-cell.tsx";

// Money measures arrive in the storage scale (minor units, ×100), one entry per currency.
const MONEY_STORAGE_SCALE = 100;

const NO_ROW: Readonly<Record<string, unknown>> = {};

function cellTypeOf(measure: DataTableMeasure, column: ListColumnViewModel | undefined): string {
  return measure.kind === "count" ? "number" : (column?.type ?? "number");
}

export function measureLabel(
  measure: DataTableMeasure,
  column: ListColumnViewModel | undefined,
  translate: ((key: string, params?: Readonly<Record<string, unknown>>) => string) | undefined,
): string {
  const label = column?.label ?? measure.field;
  return (
    translate?.(`kumiko.list.measure.${measure.kind}`, { label }) ?? `${measure.kind} ${label}`
  );
}

export function measureKindLabel(
  kind: DataTableMeasure["kind"],
  translate: ((key: string, params?: Readonly<Record<string, unknown>>) => string) | undefined,
): string {
  return translate?.(`kumiko.list.measure.kind.${kind}`) ?? kind;
}

/** One measure formatted like its column; a money measure lists every currency. */
export function MeasureValue({
  measure,
  column,
}: {
  readonly measure: DataTableMeasure;
  readonly column: ListColumnViewModel | undefined;
}): ReactNode {
  const translate = useOptionalTranslation();
  const locale = useOptionalLocale();
  const type = cellTypeOf(measure, column);
  const cell = (value: unknown, key: string): ReactNode => (
    <DataTableCell
      key={key}
      value={value}
      row={NO_ROW}
      field={measure.field}
      type={type}
      renderer={measure.kind === "count" ? undefined : column?.renderer}
      translate={translate}
      locale={locale}
      {...(column?.optionLabels !== undefined && { optionLabels: column.optionLabels })}
      {...(column?.grouping !== undefined && { grouping: column.grouping })}
    />
  );
  const { value } = measure;
  if (!isListAggregateCurrencyAmounts(value)) return cell(value, measure.kind);
  return (
    <span className="inline-flex flex-col items-end">
      {value.map((entry) =>
        cell(
          { amount: entry.value / MONEY_STORAGE_SCALE, currency: entry.currency },
          entry.currency,
        ),
      )}
    </span>
  );
}

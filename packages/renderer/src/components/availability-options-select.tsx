import type { EditFieldViewModel } from "@cosmicdrift/kumiko-headless";
import type { OptionsQueryPayload } from "@cosmicdrift/kumiko-types/fields";
import type { ReactNode } from "react";
import { useQuery } from "../hooks/use-query.js";
import { usePrimitives } from "../primitives.js";
import { resolveOptionsQueryPayload } from "./query-options-select.js";

export type SelectOptionEntry = {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly disabled?: boolean;
};

type AvailabilityRow = {
  readonly value: string;
  readonly disabled?: boolean;
  readonly hint?: string;
};

type AvailabilityResult = { readonly rows: readonly unknown[] };

// Rows come from a query handler, so they are checked once here instead of trusted.
function isAvailabilityRow(row: unknown): row is AvailabilityRow {
  return (
    typeof row === "object" &&
    row !== null &&
    "value" in row &&
    typeof row.value === "string" &&
    (!("disabled" in row) || row.disabled === undefined || typeof row.disabled === "boolean") &&
    (!("hint" in row) || row.hint === undefined || typeof row.hint === "string")
  );
}

// Static options with the translated labels of the view-model.
export function staticSelectOptions(field: EditFieldViewModel): readonly SelectOptionEntry[] {
  const labels = field.optionLabels;
  return (field.options ?? []).map((value) => ({ value, label: labels?.[value] ?? value }));
}

// Static options stay authoritative: rows for unknown values are ignored, and the
// stored value is never disabled so a downgraded tenant keeps seeing its choice.
export function mergeOptionAvailability(
  options: readonly SelectOptionEntry[],
  rows: readonly unknown[],
  current: string,
): readonly SelectOptionEntry[] {
  const byValue = new Map<string, AvailabilityRow>();
  for (const row of rows) {
    if (isAvailabilityRow(row)) byValue.set(row.value, row);
  }
  return options.map((option) => {
    const row = byValue.get(option.value);
    if (row === undefined) return option;
    const disabled = row.disabled === true && option.value !== current;
    return {
      ...option,
      ...(row.hint !== undefined && { description: row.hint }),
      ...(disabled && { disabled: true }),
    };
  });
}

type AvailabilityOptionsSelectProps = {
  readonly field: EditFieldViewModel;
  readonly query: string;
  readonly payload: OptionsQueryPayload;
  readonly row: Readonly<Record<string, unknown>>;
  readonly id: string;
  readonly hasError: boolean;
  readonly onChange: (value: unknown) => void;
};

// Select with static options whose availability (SelectFieldDef.optionsAvailabilityQuery)
// comes from a query, so it has to be a mounted component for useQuery. Until the
// result arrives, and when the query fails, every option stays choosable; the write
// path enforces the rule either way.
export function AvailabilityOptionsSelect({
  field,
  query,
  payload,
  row,
  id,
  hasError,
  onChange,
}: AvailabilityOptionsSelectProps): ReactNode {
  const { Input } = usePrimitives();
  const { data } = useQuery<AvailabilityResult>(query, resolveOptionsQueryPayload(payload, row));
  const current = typeof field.value === "string" ? field.value : "";
  const display =
    field.display === "radio" || field.display === "dropdown" ? field.display : undefined;
  return (
    <Input
      kind="select"
      id={id}
      name={field.field}
      disabled={field.readOnly}
      required={field.required}
      hasError={hasError}
      value={current}
      onChange={(v) => onChange(v)}
      options={mergeOptionAvailability(staticSelectOptions(field), data?.rows ?? [], current)}
      {...(display !== undefined && { display })}
    />
  );
}

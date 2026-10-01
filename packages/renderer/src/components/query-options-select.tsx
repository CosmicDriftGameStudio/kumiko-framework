import type { EditFieldViewModel } from "@cosmicdrift/kumiko-headless";
import type { ReactNode } from "react";
import { useQuery } from "../hooks/use-query.js";
import { usePrimitives } from "../primitives.js";

type OptionRow = { readonly value: string; readonly label: string };

type QueryOptionsSelectProps = {
  readonly field: EditFieldViewModel;
  readonly query: string;
  readonly payload: Readonly<Record<string, string | number | boolean>>;
  readonly id: string;
  readonly hasError: boolean;
  readonly onChange: (value: unknown) => void;
};

// Select whose options come from a query (SelectFieldDef.optionsQuery), so it
// has to be a mounted component for useQuery. useQuery re-fetches on the
// serialized payload, hence no payload memoization here.
export function QueryOptionsSelect({
  field,
  query,
  payload,
  id,
  hasError,
  onChange,
}: QueryOptionsSelectProps): ReactNode {
  const { Input } = usePrimitives();
  const { data, loading } = useQuery<{ rows: readonly OptionRow[] }>(query, payload);
  const current = typeof field.value === "string" ? field.value : "";
  const rows = data?.rows ?? [];
  // A stored value missing from the result (still loading, or dropped from the
  // catalog) must stay visible instead of silently turning into "nothing selected".
  const options =
    current !== "" && !rows.some((row) => row.value === current)
      ? [{ value: current, label: current }, ...rows]
      : rows;
  // Keeps the presentation stable: without it the empty loading state would pick
  // radio/dropdown by option count and jump once the rows arrive.
  const display =
    field.display === "radio" || field.display === "dropdown" ? field.display : "dropdown";
  return (
    <Input
      kind="select"
      id={id}
      name={field.field}
      disabled={field.readOnly || loading}
      required={field.required}
      hasError={hasError}
      value={current}
      onChange={(v) => onChange(v)}
      options={options}
      display={display}
    />
  );
}

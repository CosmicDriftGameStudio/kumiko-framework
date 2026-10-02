import type { EditFieldViewModel } from "@cosmicdrift/kumiko-headless";
import { isOptionsQueryFieldRef, type OptionsQueryPayload } from "@cosmicdrift/kumiko-types/fields";
import { type ReactNode, useEffect, useRef } from "react";
import { useQuery } from "../hooks/use-query.js";
import { usePrimitives } from "../primitives.js";

type OptionRow = {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly group?: string;
};

type OptionsQueryResult = { readonly rows: readonly OptionRow[] };

type ResolvedOptionsQueryPayload = Readonly<Record<string, string | number | boolean>>;

function isPayloadScalar(value: unknown): value is string | number | boolean {
  return (
    (typeof value === "string" && value !== "") ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

// An empty sibling value drops its key, so "nothing chosen yet" reaches the query
// handler as an absent property, not as "" / null.
export function resolveOptionsQueryPayload(
  payload: OptionsQueryPayload,
  row: Readonly<Record<string, unknown>>,
): ResolvedOptionsQueryPayload {
  const resolved: Record<string, string | number | boolean> = {};
  for (const [name, entry] of Object.entries(payload)) {
    const value = isOptionsQueryFieldRef(entry) ? row[entry.field] : entry;
    if (isPayloadScalar(value)) resolved[name] = value;
  }
  return resolved;
}

type QueryOptionsSelectProps = {
  readonly field: EditFieldViewModel;
  readonly query: string;
  readonly payload: OptionsQueryPayload;
  readonly row: Readonly<Record<string, unknown>>;
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
  row,
  id,
  hasError,
  onChange,
}: QueryOptionsSelectProps): ReactNode {
  const { Input } = usePrimitives();
  const resolvedPayload = resolveOptionsQueryPayload(payload, row);
  const payloadKey = JSON.stringify(resolvedPayload);
  const { data, loading } = useQuery<OptionsQueryResult>(query, resolvedPayload);
  const current = typeof field.value === "string" ? field.value : "";
  const rows = data?.rows ?? [];

  // useQuery keeps the previous data while a changed payload reloads, and a
  // superseded response is aborted — so a fresh `data` object always belongs to
  // the payload of the render it arrives in. The first load never clears (a stored
  // value missing there stays visible); only a load after a payload change does.
  const settledPayloadKey = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per loaded result, not on every keystroke
  useEffect(() => {
    if (data === null) return;
    const previousKey = settledPayloadKey.current;
    settledPayloadKey.current = payloadKey;
    const payloadChanged = previousKey !== null && previousKey !== payloadKey;
    if (payloadChanged && current !== "" && !data.rows.some((row) => row.value === current)) {
      onChange("");
    }
  }, [data]);

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

// Badge text for a stored value of an optionsQuery select: the row's label once
// loaded, the raw value while loading or when the value is not in the result.
export function QueryOptionLabel({
  query,
  payload,
  value,
}: {
  readonly query: string;
  readonly payload: ResolvedOptionsQueryPayload;
  readonly value: string | number | boolean;
}): ReactNode {
  const { data } = useQuery<OptionsQueryResult>(query, payload);
  const label = data?.rows.find((row) => row.value === value)?.label;
  return label ?? String(value);
}

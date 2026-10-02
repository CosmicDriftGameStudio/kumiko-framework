import type { DataTableSort } from "./primitives.js";

type SortValue = string | number | null;

function compareNonNull(a: string | number, b: string | number, collator: Intl.Collator): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a), String(b));
}

/** Sorts `rows` by a `DataTableSort` against a field->accessor map. Unknown
 *  field or `sort === null` returns `rows` unchanged (no-op, not an error —
 *  callers pass whatever the DataTable reports). `null` values sort last in
 *  both directions; strings compare locale-aware with numeric collation, so
 *  numeric strings (Postgres numeric/bigint) order by value. */
export function sortByAccessor<TRow>(
  rows: readonly TRow[],
  sort: DataTableSort | null,
  accessors: Readonly<Record<string, (row: TRow) => SortValue>>,
  locale?: string,
): readonly TRow[] {
  if (sort === null) return rows;
  const accessor = accessors[sort.field];
  if (accessor === undefined) return rows;
  const factor = sort.dir === "asc" ? 1 : -1;
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  return [...rows].sort((a, b) => {
    const av = accessor(a);
    const bv = accessor(b);
    if (av === null || bv === null) return av === bv ? 0 : av === null ? 1 : -1;
    return factor * compareNonNull(av, bv, collator);
  });
}

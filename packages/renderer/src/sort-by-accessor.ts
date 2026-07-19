import type { DataTableSort } from "./primitives";

/** Sorts `rows` by a `DataTableSort` against a field->accessor map. Unknown
 *  field or `sort === null` returns `rows` unchanged (no-op, not an error —
 *  callers pass whatever the DataTable reports). */
export function sortByAccessor<TRow>(
  rows: readonly TRow[],
  sort: DataTableSort | null,
  accessors: Readonly<Record<string, (row: TRow) => string | number>>,
): readonly TRow[] {
  if (sort === null) return rows;
  const accessor = accessors[sort.field];
  if (accessor === undefined) return rows;
  const factor = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = accessor(a);
    const bv = accessor(b);
    return av < bv ? -factor : av > bv ? factor : 0;
  });
}

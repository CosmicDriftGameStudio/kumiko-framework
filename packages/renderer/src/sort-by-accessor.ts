import type { DataTableSort } from "./primitives.tsx";

type SortValue = string | number | null;

export type SortByAccessorOptions<TRow> = {
  /** Where `null` lands for a sort; without it `null` sorts last in both directions. */
  readonly nullsFirst?: (sort: DataTableSort) => boolean;
  /** Orders rows whose sort values are equal, in both directions. */
  readonly tieBreaker?: (a: TRow, b: TRow) => number;
};

function compareNonNull(a: string | number, b: string | number, collator: Intl.Collator): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a), String(b));
}

/** Sorts `rows` by a `DataTableSort` against a field->accessor map. Unknown
 *  field or `sort === null` returns `rows` unchanged (no-op, not an error —
 *  callers pass whatever the DataTable reports). `null` values sort last in
 *  both directions unless `options.nullsFirst` says otherwise; strings compare
 *  locale-aware with numeric collation, so numeric strings (Postgres
 *  numeric/bigint) order by value. */
export function sortByAccessor<TRow>(
  rows: readonly TRow[],
  sort: DataTableSort | null,
  accessors: Readonly<Record<string, (row: TRow) => SortValue>>,
  locale?: string,
  options: SortByAccessorOptions<TRow> = {},
): readonly TRow[] {
  if (sort === null) return rows;
  const accessor = accessors[sort.field];
  if (accessor === undefined) return rows;
  const factor = sort.dir === "asc" ? 1 : -1;
  const nullFactor = options.nullsFirst?.(sort) === true ? -1 : 1;
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const compareValues = (av: SortValue, bv: SortValue): number => {
    if (av === null || bv === null) {
      return av === bv ? 0 : nullFactor * (av === null ? 1 : -1);
    }
    return factor * compareNonNull(av, bv, collator);
  };
  const tieBreaker = options.tieBreaker;
  return [...rows].sort((a, b) => {
    const byValue = compareValues(accessor(a), accessor(b));
    return byValue !== 0 || tieBreaker === undefined ? byValue : tieBreaker(a, b);
  });
}

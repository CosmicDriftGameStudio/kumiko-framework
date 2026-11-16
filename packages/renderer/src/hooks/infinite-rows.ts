export type RowIdOf<TRow> = (row: TRow, index: number) => unknown;

export function rowIdSet<TRow>(
  rows: readonly TRow[],
  rowIdOf: RowIdOf<TRow>,
): ReadonlySet<unknown> {
  return new Set(rows.map((row, index) => rowIdOf(row, index)));
}

// A live refresh can move a row onto a later page that was already appended.
export function appendUnseenRows<TRow>(
  loaded: readonly TRow[],
  nextPage: readonly TRow[],
  rowIdOf: RowIdOf<TRow>,
): readonly TRow[] {
  const seen = rowIdSet(loaded, rowIdOf);
  return [...loaded, ...nextPage.filter((row, index) => !seen.has(rowIdOf(row, index)))];
}

// A row missing from the fresh first page either belongs to an already loaded later page and stays, or was on the old first page (deleted or filtered out) and drops.
export function mergeFreshFirstPage<TRow>(args: {
  readonly loadedRows: readonly TRow[];
  readonly previousFirstPageIds: ReadonlySet<unknown>;
  readonly freshFirstPage: readonly TRow[];
  readonly rowIdOf: RowIdOf<TRow>;
}): readonly TRow[] {
  const { loadedRows, previousFirstPageIds, freshFirstPage, rowIdOf } = args;
  const freshIds = rowIdSet(freshFirstPage, rowIdOf);
  const laterRows = loadedRows.filter((row, index) => {
    const id = rowIdOf(row, index);
    return !freshIds.has(id) && !previousFirstPageIds.has(id);
  });
  return [...freshFirstPage, ...laterRows];
}

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

// A row of the old first page that the fresh page lacks was deleted or filtered out if the fresh page is the
// last one or shows a row that followed it after one that preceded it; otherwise an insert or re-sort above pushed it
// onto the loaded page 2 and it stays. A deletion and a later row re-sorted into exactly that slot look alike and drop.
export function mergeFreshFirstPage<TRow>(args: {
  readonly loadedRows: readonly TRow[];
  readonly previousFirstPageIds: ReadonlySet<unknown>;
  readonly freshFirstPage: readonly TRow[];
  readonly freshPageHasNextPage: boolean;
  readonly rowIdOf: RowIdOf<TRow>;
}): readonly TRow[] {
  const { loadedRows, previousFirstPageIds, freshFirstPage, freshPageHasNextPage, rowIdOf } = args;
  const freshIds = rowIdSet(freshFirstPage, rowIdOf);
  const loadedPositionById = new Map(loadedRows.map((row, index) => [rowIdOf(row, index), index]));
  const freshLoadedPositions = freshFirstPage.map((row, index) =>
    loadedPositionById.get(rowIdOf(row, index)),
  );
  const freshPageCoversLoadedPosition = (loadedPosition: number): boolean => {
    let lastPredecessorFreshIndex = -1;
    freshLoadedPositions.forEach((position, freshIndex) => {
      if (position !== undefined && position < loadedPosition) {
        lastPredecessorFreshIndex = freshIndex;
      }
    });
    return freshLoadedPositions.some(
      (position, freshIndex) =>
        position !== undefined &&
        position > loadedPosition &&
        freshIndex > lastPredecessorFreshIndex,
    );
  };
  const laterRows = loadedRows.filter((row, index) => {
    const id = rowIdOf(row, index);
    if (freshIds.has(id)) return false;
    if (!previousFirstPageIds.has(id)) return true;
    return freshPageHasNextPage && !freshPageCoversLoadedPosition(index);
  });
  return [...freshFirstPage, ...laterRows];
}

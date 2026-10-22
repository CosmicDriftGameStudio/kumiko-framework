import { MAX_BULK_SELECTION } from "@cosmicdrift/kumiko-framework/ui-types";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ListRowViewModel } from "../../../headless/index.ts";

export type SelectAllState = "all" | "some" | "none";

export type RowSelection = {
  readonly selectedRows: readonly ListRowViewModel[];
  readonly isSelected: (rowId: string) => boolean;
  readonly isFull: boolean;
  readonly allState: SelectAllState;
  readonly toggle: (rowId: string) => void;
  readonly toggleAll: () => void;
  readonly retainOnly: (rowIds: ReadonlySet<string>) => void;
  readonly clear: () => void;
};

const NOTHING_SELECTED: ReadonlySet<string> = new Set();

function retained(
  previous: ReadonlySet<string>,
  keep: (id: string) => boolean,
): ReadonlySet<string> {
  const next = new Set([...previous].filter(keep));
  return next.size === previous.size ? previous : next;
}

/** Checkbox selection over the loaded rows, capped at MAX_BULK_SELECTION. Rows that leave the list leave the selection. */
export function useRowSelection(rows: readonly ListRowViewModel[]): RowSelection {
  const [selectedIds, setSelectedIds] = useState(NOTHING_SELECTED);

  useEffect(() => {
    // skip: an empty list is the reload gap between two fetches; pruning then would drop the failed rows a run keeps selected
    if (rows.length === 0) return;
    const loaded = new Set(rows.map((row) => row.id));
    setSelectedIds((previous) => retained(previous, (id) => loaded.has(id)));
  }, [rows]);

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.has(row.id)),
    [rows, selectedIds],
  );
  const selectableCount = Math.min(rows.length, MAX_BULK_SELECTION);
  const allState: SelectAllState =
    selectedRows.length === 0 ? "none" : selectedRows.length >= selectableCount ? "all" : "some";

  const toggle = useCallback((rowId: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(rowId)) next.delete(rowId);
      else if (next.size < MAX_BULK_SELECTION) next.add(rowId);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds(
      allState === "all"
        ? NOTHING_SELECTED
        : new Set(rows.slice(0, MAX_BULK_SELECTION).map((row) => row.id)),
    );
  }, [allState, rows]);

  const retainOnly = useCallback(
    (rowIds: ReadonlySet<string>) =>
      setSelectedIds((previous) => retained(previous, (id) => rowIds.has(id))),
    [],
  );
  const clear = useCallback(() => setSelectedIds(NOTHING_SELECTED), []);

  return {
    selectedRows,
    isSelected: (rowId) => selectedIds.has(rowId),
    isFull: selectedIds.size >= MAX_BULK_SELECTION,
    allState,
    toggle,
    toggleAll,
    retainOnly,
    clear,
  };
}

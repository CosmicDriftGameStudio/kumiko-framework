import { normalizeListColumn } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ListColumnSpec, ListTableOptions } from "@cosmicdrift/kumiko-types/screen";
import { useCallback, useMemo, useState } from "react";
import type { ListStateStore } from "../components/list-state-store.tsx";
import type { DataTableDensity, DataTableViewColumn } from "../data-table-view-types.ts";
import { sanitizeStoredListState } from "./list-state-schema.ts";

export type ListViewSchemaColumn = { readonly field: string; readonly hidden?: boolean };

type ViewState = {
  readonly columns: readonly DataTableViewColumn[];
  readonly density: DataTableDensity;
};

export type ListViewState = {
  /** Undefined unless `table.columnPicker` is on. */
  readonly columns: readonly DataTableViewColumn[] | undefined;
  readonly density: DataTableDensity;
  readonly userChoosesDensity: boolean;
  readonly setColumns: (next: readonly DataTableViewColumn[]) => void;
  readonly setDensity: (next: DataTableDensity) => void;
  readonly resetView: () => void;
  readonly viewIsDefault: boolean;
};

export function listViewSchemaColumns(columns: readonly ListColumnSpec[]): ListViewSchemaColumn[] {
  return columns.map((column) => {
    const { field, hidden } = normalizeListColumn(column);
    return { field, ...(hidden === true && { hidden }) };
  });
}

function schemaDefaultColumns(schema: readonly ListViewSchemaColumn[]): DataTableViewColumn[] {
  return schema.map((column) => ({ field: column.field, visible: column.hidden !== true }));
}

/** Saved order wins; a column the saved view has never seen takes its schema
 *  position (after its schema predecessor) with its schema default. */
function mergeSavedColumns(
  schema: readonly ListViewSchemaColumn[],
  saved: readonly DataTableViewColumn[],
): DataTableViewColumn[] {
  const merged = [...saved];
  const present = new Set(saved.map((column) => column.field));
  schema.forEach((column, index) => {
    // skip: column already saved
    if (present.has(column.field)) return;
    const predecessor = schema[index - 1];
    const predecessorAt =
      predecessor === undefined ? -1 : merged.findIndex((m) => m.field === predecessor.field);
    merged.splice(predecessorAt + 1, 0, {
      field: column.field,
      visible: column.hidden !== true,
    });
    present.add(column.field);
  });
  return merged;
}

function sameColumns(a: readonly DataTableViewColumn[], b: readonly DataTableViewColumn[]) {
  return (
    a.length === b.length &&
    a.every((c, i) => c.field === b[i]?.field && c.visible === b[i]?.visible)
  );
}

function hasVisibleColumn(columns: readonly DataTableViewColumn[]): boolean {
  return columns.some((column) => column.visible);
}

type ViewStateArgs = {
  readonly storeKey: string;
  readonly store: ListStateStore;
  readonly table: ListTableOptions;
  readonly schemaColumns: readonly ListViewSchemaColumn[];
};

function readInitialView(args: ViewStateArgs, defaults: ViewState): ViewState {
  const saved = sanitizeStoredListState(args.store.read(args.storeKey), {
    columnFields: args.schemaColumns.map((column) => column.field),
    filterFields: [],
  })?.view;
  const merged =
    args.table.columnPicker === true && saved?.columns !== undefined
      ? mergeSavedColumns(args.schemaColumns, saved.columns)
      : defaults.columns;
  return {
    columns: hasVisibleColumn(merged) ? merged : defaults.columns,
    density:
      args.table.density?.userChoice === true && saved?.density ? saved.density : defaults.density,
  };
}

/** Column choice, order and density of one list. Lives in the list-state store
 *  (never in the URL) and is independent of `rememberState`. */
export function useListViewState(args: ViewStateArgs): ListViewState {
  const { storeKey, store, table, schemaColumns } = args;
  const columnPicker = table.columnPicker === true;
  const userChoosesDensity = table.density?.userChoice === true;
  const defaults = useMemo<ViewState>(
    () => ({
      columns: schemaDefaultColumns(schemaColumns),
      density: table.density?.default ?? "comfortable",
    }),
    [schemaColumns, table.density?.default],
  );

  const [seeded, setSeeded] = useState(() => ({
    storeKey,
    view: readInitialView(args, defaults),
  }));
  const view = seeded.storeKey === storeKey ? seeded.view : readInitialView(args, defaults);
  if (seeded.storeKey !== storeKey) setSeeded({ storeKey, view });

  const commit = useCallback(
    (next: ViewState) => {
      setSeeded({ storeKey, view: next });
      store.write(storeKey, {
        ...store.read(storeKey),
        view: {
          ...(columnPicker && { columns: next.columns }),
          ...(userChoosesDensity && { density: next.density }),
        },
      });
    },
    [store, storeKey, columnPicker, userChoosesDensity],
  );

  const setColumns = useCallback(
    (next: readonly DataTableViewColumn[]) => {
      // skip: a view must keep at least one visible column
      if (!hasVisibleColumn(next)) return;
      commit({ ...view, columns: next });
    },
    [commit, view],
  );
  const setDensity = useCallback(
    (next: DataTableDensity) => commit({ ...view, density: next }),
    [commit, view],
  );
  const resetView = useCallback(() => {
    setSeeded({ storeKey, view: defaults });
    const { view: _dropped, ...rest } = store.read(storeKey) ?? {};
    store.write(storeKey, rest);
  }, [store, storeKey, defaults]);

  return {
    columns: columnPicker ? view.columns : undefined,
    density: view.density,
    userChoosesDensity,
    setColumns,
    setDensity,
    resetView,
    viewIsDefault:
      view.density === defaults.density &&
      (!columnPicker || sameColumns(view.columns, defaults.columns)),
  };
}

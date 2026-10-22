import { normalizeListColumn } from "@cosmicdrift/kumiko-framework/ui-types";
import type {
  ListColumnPin,
  ListColumnSpec,
  ListTableOptions,
} from "@cosmicdrift/kumiko-types/screen";
import { useCallback, useMemo, useState } from "react";
import type { ListStateStore } from "../components/list-state-store.tsx";
import type {
  DataTableColumnPins,
  DataTableColumnWidths,
  DataTableDensity,
  DataTableViewColumn,
} from "../data-table-view-types.ts";
import {
  clampWidth,
  DEFAULT_MIN_COLUMN_WIDTH_PX,
  defaultPins,
  defaultWidths,
  mergeSavedWidths,
  minWidthsOf,
  sameRecord,
} from "./list-column-layout.ts";
import { sanitizeStoredListState } from "./list-state-schema.ts";

export type ListViewSchemaColumn = {
  readonly field: string;
  readonly hidden?: boolean;
  readonly pinned?: ListColumnPin;
  readonly width?: number;
  readonly minWidth?: number;
};

type ViewState = {
  readonly columns: readonly DataTableViewColumn[];
  readonly density: DataTableDensity;
  readonly pins: DataTableColumnPins;
  readonly widths: DataTableColumnWidths;
  /** "" = not grouped. */
  readonly groupBy: string;
};

export type ListViewState = {
  /** Undefined unless `table.columnPicker` is on. */
  readonly columns: readonly DataTableViewColumn[] | undefined;
  readonly density: DataTableDensity;
  readonly userChoosesDensity: boolean;
  readonly setColumns: (next: readonly DataTableViewColumn[]) => void;
  readonly setDensity: (next: DataTableDensity) => void;
  /** Undefined unless `table.pinning` is on. */
  readonly pins: DataTableColumnPins | undefined;
  readonly setPins: (next: DataTableColumnPins) => void;
  /** Undefined unless `table.resizing` is on. */
  readonly widths: DataTableColumnWidths | undefined;
  readonly minWidths: DataTableColumnWidths | undefined;
  readonly setWidth: (field: string, width: number) => void;
  /** Active group field, "" = not grouped. */
  readonly groupBy: string;
  /** Undefined unless `table.grouping.userChoice` is on. */
  readonly groupByFields: readonly string[] | undefined;
  readonly setGroupBy: (next: string) => void;
  readonly resetView: () => void;
  readonly viewIsDefault: boolean;
};

export function listViewSchemaColumns(columns: readonly ListColumnSpec[]): ListViewSchemaColumn[] {
  return columns.map((column) => {
    const { field, hidden, pinned, width, minWidth } = normalizeListColumn(column);
    return {
      field,
      ...(hidden === true && { hidden }),
      ...(pinned !== undefined && { pinned }),
      ...(width !== undefined && { width }),
      ...(minWidth !== undefined && { minWidth }),
    };
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

function groupByChoices(grouping: ListTableOptions["grouping"]): readonly string[] | undefined {
  if (grouping?.userChoice !== true) return undefined;
  const offered = [
    ...(grouping.field !== undefined ? [grouping.field] : []),
    ...(grouping.fields ?? []),
  ];
  return [...new Set(offered)];
}

function isOfferedGroupBy(
  grouping: ListTableOptions["grouping"],
  saved: string | undefined,
): saved is string {
  if (saved === undefined) return false;
  const choices = groupByChoices(grouping);
  return choices !== undefined && (saved === "" || choices.includes(saved));
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
  const savedGroupBy = saved?.groupBy;
  const merged =
    args.table.columnPicker === true && saved?.columns !== undefined
      ? mergeSavedColumns(args.schemaColumns, saved.columns)
      : defaults.columns;
  return {
    columns: hasVisibleColumn(merged) ? merged : defaults.columns,
    density:
      args.table.density?.userChoice === true && saved?.density ? saved.density : defaults.density,
    // Saved pins replace the schema pins entirely, so the user can release a schema pin.
    pins: args.table.pinning === true && saved?.pins !== undefined ? saved.pins : defaults.pins,
    widths:
      args.table.resizing === true && saved?.widths !== undefined
        ? mergeSavedWidths(defaults.widths, saved.widths, minWidthsOf(args.schemaColumns))
        : defaults.widths,
    groupBy: isOfferedGroupBy(args.table.grouping, savedGroupBy) ? savedGroupBy : defaults.groupBy,
  };
}

/** Column choice, order and density of one list. Lives in the list-state store
 *  (never in the URL) and is independent of `rememberState`. */
export function useListViewState(args: ViewStateArgs): ListViewState {
  const { storeKey, store, table, schemaColumns } = args;
  const columnPicker = table.columnPicker === true;
  const userChoosesDensity = table.density?.userChoice === true;
  const pinning = table.pinning === true;
  const resizing = table.resizing === true;
  const groupByFields = useMemo(() => groupByChoices(table.grouping), [table.grouping]);
  const userChoosesGroupBy = groupByFields !== undefined;
  const minWidths = useMemo(() => minWidthsOf(schemaColumns), [schemaColumns]);
  const defaults = useMemo<ViewState>(
    () => ({
      columns: schemaDefaultColumns(schemaColumns),
      density: table.density?.default ?? "comfortable",
      pins: pinning ? defaultPins(schemaColumns) : {},
      widths: resizing ? defaultWidths(schemaColumns, minWidths) : {},
      groupBy: table.grouping?.field ?? "",
    }),
    [schemaColumns, table.density?.default, pinning, resizing, minWidths, table.grouping?.field],
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
          ...(pinning && { pins: next.pins }),
          ...(resizing && { widths: next.widths }),
          ...(userChoosesGroupBy && { groupBy: next.groupBy }),
        },
      });
    },
    [store, storeKey, columnPicker, userChoosesDensity, pinning, resizing, userChoosesGroupBy],
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
  const setPins = useCallback(
    (next: DataTableColumnPins) => commit({ ...view, pins: next }),
    [commit, view],
  );
  const setWidth = useCallback(
    (field: string, width: number) =>
      commit({
        ...view,
        widths: {
          ...view.widths,
          [field]: clampWidth(width, minWidths[field] ?? DEFAULT_MIN_COLUMN_WIDTH_PX),
        },
      }),
    [commit, view, minWidths],
  );
  const setGroupBy = useCallback(
    (next: string) => commit({ ...view, groupBy: next }),
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
    pins: pinning ? view.pins : undefined,
    setPins,
    widths: resizing ? view.widths : undefined,
    minWidths: resizing ? minWidths : undefined,
    setWidth,
    groupBy: view.groupBy,
    groupByFields,
    setGroupBy,
    resetView,
    viewIsDefault:
      view.density === defaults.density &&
      (!columnPicker || sameColumns(view.columns, defaults.columns)) &&
      (!pinning || sameRecord(view.pins, defaults.pins)) &&
      (!resizing || sameRecord(view.widths, defaults.widths)) &&
      view.groupBy === defaults.groupBy,
  };
}

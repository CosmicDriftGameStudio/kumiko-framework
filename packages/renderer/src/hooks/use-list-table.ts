import type { ListTableOptions } from "@cosmicdrift/kumiko-types/screen";
import { useCallback, useMemo } from "react";
import { useNav } from "../app/nav.tsx";
import { useListStateStore } from "../components/list-state-store.tsx";
import type {
  DataTableExport,
  DataTableResetAll,
  DataTableViewOptions,
} from "../data-table-view-types.ts";
import { isListStateAtDefault, listResetUpdates } from "./list-reset.ts";
import { type ListViewSchemaColumn, useListViewState } from "./use-list-view-state.ts";

const NO_TABLE_OPTIONS: ListTableOptions = {};

type ListTableArgs = {
  readonly storeKey: string;
  /** Undefined: the list has no `table` block and nothing below is active. */
  readonly table: ListTableOptions | undefined;
  /** Must be referentially stable across renders. */
  readonly schemaColumns: readonly ListViewSchemaColumn[];
  /** URL-backed list (entityList, projectionList): reset clears the `<screenId>.*` keys. */
  readonly url?: { readonly screenId: string };
  /** List with component-local state (relatedList): the owner resets it. */
  readonly local?: { readonly atDefault: boolean; readonly reset: () => void };
  /** Screen identity and current list payload; used only when `table.export.xlsx` is on. */
  readonly exportSource?: {
    readonly screen: string;
    readonly screenShortId: string;
    readonly payload: Readonly<Record<string, unknown>>;
  };
};

export type ListTableProps = {
  readonly view?: DataTableViewOptions;
  readonly resetAll?: DataTableResetAll;
  readonly exportList?: DataTableExport;
  readonly compactHeader?: boolean;
};

export type ListTableState = {
  readonly props: ListTableProps;
  /** Field the list is grouped by right now; undefined = ungrouped. */
  readonly groupField: string | undefined;
};

const PAGING_PAYLOAD_KEYS = ["limit", "offset", "cursor", "totalCount", "filter"] as const;

function withoutPaging(payload: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const kept: Record<string, unknown> = { ...payload };
  for (const key of PAGING_PAYLOAD_KEYS) delete kept[key];
  return kept;
}

/** Props for the DataTable's `view` / `resetAll` from a screen's `table` block. */
export function useListTable({
  storeKey,
  table,
  schemaColumns,
  url,
  local,
  exportSource,
}: ListTableArgs): ListTableState {
  const nav = useNav();
  const store = useListStateStore();
  const options = table ?? NO_TABLE_OPTIONS;
  const viewState = useListViewState({ storeKey, store, table: options, schemaColumns });

  const urlParams = nav.searchParams;
  const urlScreenId = url?.screenId;
  const localAtDefault = local?.atDefault;
  const localReset = local?.reset;
  const atDefault =
    urlScreenId !== undefined
      ? isListStateAtDefault(urlParams, urlScreenId)
      : (localAtDefault ?? true);

  // The remembered view (columns, density) survives: "reset view" is its own action.
  const onReset = useCallback(() => {
    if (urlScreenId !== undefined) nav.setSearchParams(listResetUpdates(urlParams, urlScreenId));
    localReset?.();
    const { params: _forgotten, ...kept } = store.read(storeKey) ?? {};
    if (kept.view === undefined) store.remove(storeKey);
    else store.write(storeKey, kept);
  }, [nav, urlParams, urlScreenId, localReset, store, storeKey]);

  const resetAll = useMemo<DataTableResetAll | undefined>(
    () => (options.resetAll === true ? { active: !atDefault, onReset } : undefined),
    [options.resetAll, atDefault, onReset],
  );

  const hasView =
    options.columnPicker === true ||
    options.density !== undefined ||
    options.pinning === true ||
    options.resizing === true ||
    options.keyboardNavigation === true ||
    viewState.groupByFields !== undefined;
  const view = useMemo<DataTableViewOptions | undefined>(
    () =>
      hasView
        ? {
            ...(viewState.columns !== undefined && {
              columns: viewState.columns,
              onColumnsChange: viewState.setColumns,
            }),
            density: viewState.density,
            ...(viewState.userChoosesDensity && { onDensityChange: viewState.setDensity }),
            ...(viewState.pins !== undefined && {
              pins: viewState.pins,
              onPinsChange: viewState.setPins,
            }),
            ...(viewState.widths !== undefined &&
              viewState.minWidths !== undefined && {
                widths: viewState.widths,
                minWidths: viewState.minWidths,
                onWidthChange: viewState.setWidth,
              }),
            ...(options.keyboardNavigation === true && { keyboardNavigation: true }),
            ...(viewState.groupByFields !== undefined && {
              groupBy: {
                value: viewState.groupBy,
                fields: viewState.groupByFields,
                onChange: viewState.setGroupBy,
              },
            }),
            viewIsDefault: viewState.viewIsDefault,
            onViewReset: viewState.resetView,
          }
        : undefined,
    [hasView, viewState, options.keyboardNavigation],
  );

  const exportEnabled = options.export?.xlsx === true;
  const viewColumns = viewState.columns;
  const exportList = useMemo<DataTableExport | undefined>(() => {
    if (!exportEnabled || exportSource === undefined) return undefined;
    const ordered =
      viewColumns?.filter((column) => column.visible).map((column) => column.field) ??
      schemaColumns.map((column) => column.field);
    return { ...exportSource, payload: withoutPaging(exportSource.payload), columns: ordered };
  }, [exportEnabled, exportSource, viewColumns, schemaColumns]);

  const props = useMemo<ListTableProps>(
    () => ({
      ...(view !== undefined && { view }),
      ...(resetAll !== undefined && { resetAll }),
      ...(exportList !== undefined && { exportList }),
      ...(options.compactHeader === true && { compactHeader: true }),
    }),
    [view, resetAll, exportList, options.compactHeader],
  );
  const groupField =
    options.grouping !== undefined && viewState.groupBy !== "" ? viewState.groupBy : undefined;
  return { props, groupField };
}

import { type Dispatch, type SetStateAction, useId, useState } from "react";
import { useIsEmbeddedScreen } from "../../../context/embedded-screen-context.tsx";
import type { ListColumnViewModel, ListRowViewModel } from "../../../headless/index.ts";
import { type DataTableProps, useOptionalLocale, useOptionalTranslation } from "../../../index.ts";
import { useIsNarrowViewport } from "../use-narrow-viewport.ts";
import { isPinningActive, isResizingActive } from "./column-layout-mode.ts";
import { densityClasses } from "./density.ts";
import { buildDataTableItems } from "./group-band.tsx";
import { useBulkSelection } from "./use-bulk-selection.tsx";
import { type ColumnPins, useColumnPins } from "./use-column-pins.ts";
import { useColumnSizing } from "./use-column-sizing.ts";
import { useMeasuredColumnWidths } from "./use-measured-column-widths.ts";
import { useRowKeyboardNavigation } from "./use-row-keyboard-navigation.ts";
import { useViewColumns } from "./use-view-columns.ts";

type RowExpansion = {
  readonly renderExpandedRow: NonNullable<DataTableProps["renderExpandedRow"]>;
  readonly onToggleRowExpanded: NonNullable<DataTableProps["onToggleRowExpanded"]>;
};

export type DataTableModel = Omit<DataTableProps, "columns"> & {
  readonly schemaColumns: readonly ListColumnViewModel[];
  readonly columns: ColumnPins<ListColumnViewModel>["columns"];
  readonly tableTranslate: ReturnType<typeof useOptionalTranslation>;
  readonly tableLocale: ReturnType<typeof useOptionalLocale>;
  readonly isNarrow: boolean;
  readonly density: ReturnType<typeof densityClasses>;
  readonly facetsOpenNarrow: boolean;
  readonly setFacetsOpenNarrow: Dispatch<SetStateAction<boolean>>;
  readonly menuActions: DataTableProps["rowActions"];
  readonly tableActions: DataTableProps["rowActions"];
  readonly rowClickLabel: string | undefined;
  readonly rowOpener: (row: ListRowViewModel) => (() => void) | undefined;
  readonly hasTableActions: boolean;
  readonly isEmpty: boolean;
  readonly rowTestId: (row: ListRowViewModel) => string;
  readonly expansion: RowExpansion | undefined;
  readonly fillsHeight: boolean;
  readonly insideEmbeddedScreen: boolean;
  readonly selection: ReturnType<typeof useBulkSelection>;
  readonly headerRowRef: ReturnType<typeof useMeasuredColumnWidths>["headerRowRef"];
  readonly pins: ColumnPins<ListColumnViewModel>;
  readonly sizing: ReturnType<typeof useColumnSizing>;
  readonly fullColSpan: number;
  readonly expansionDomId: (row: ListRowViewModel) => string;
  readonly tableItems: ReturnType<typeof buildDataTableItems>;
  readonly keyboardRow: ReturnType<typeof useRowKeyboardNavigation>;
  readonly columnOf: (field: string) => ListColumnViewModel | undefined;
};

function resolveRowActions({
  rowActions,
  onRowClick,
  rowActionMode,
  onCellChange,
}: Pick<DataTableProps, "rowActions" | "onRowClick" | "rowActionMode" | "onCellChange">) {
  // The row click already runs rowClick actions, so with a clickable row they
  // must not reappear in the kebab (a list whose only action is the rowClick
  // one gets no actions column at all).
  const menuActions =
    rowActions !== undefined && onRowClick !== undefined
      ? rowActions.filter((action) => action.rowClick !== true)
      : rowActions;
  // The table keeps every action in "inline" mode, and with editable cells the
  // first cell is not a keyboard link (FirstCellLink is off), so the kebab is
  // then the only keyboard route to the rowClick action.
  const tableActions =
    rowActionMode === "inline" || onCellChange !== undefined ? rowActions : menuActions;
  const rowClickAction = rowActions?.find((action) => action.rowClick === true);
  const rowClickIsHidden = (row: ListRowViewModel): boolean =>
    rowClickAction?.isVisible !== undefined && !rowClickAction.isVisible(row);
  const rowOpener = (row: ListRowViewModel): (() => void) | undefined =>
    onRowClick !== undefined && !rowClickIsHidden(row) ? () => onRowClick(row) : undefined;
  return { menuActions, tableActions, rowClickLabel: rowClickAction?.label, rowOpener };
}

function resolveRowExpansion({
  renderExpandedRow,
  onToggleRowExpanded,
}: Pick<DataTableProps, "renderExpandedRow" | "onToggleRowExpanded">): RowExpansion | undefined {
  if (renderExpandedRow === undefined || onToggleRowExpanded === undefined) return undefined;
  return { renderExpandedRow, onToggleRowExpanded };
}

function isEmptyTable({ rows, serverGroups }: Pick<DataTableProps, "rows" | "serverGroups">) {
  return rows.length === 0 && (serverGroups?.groups.length ?? 0) === 0;
}

export function useDataTableState(props: DataTableProps): DataTableModel {
  const {
    columns: schemaColumns,
    rows,
    view,
    scrollBody,
    serverGroups,
    bulk,
    getRowTestId,
  } = props;
  // One locale/translate subscription per table — not per cell.
  // Optional hooks: a bare DataTable outside LocaleProvider must not crash.
  const tableTranslate = useOptionalTranslation();
  const tableLocale = useOptionalLocale();
  // Below 768px a table scrolls its columns out of reach with no visible
  // affordance. Cards replace the table entirely below the breakpoint — same
  // single-mount pattern as EmbeddedListInput/embedded-list-input.tsx.
  const isNarrow = useIsNarrowViewport();
  const viewColumns = useViewColumns(schemaColumns, view, isNarrow);
  const density = densityClasses(view, scrollBody === true);
  const [facetsOpenNarrow, setFacetsOpenNarrow] = useState(false);
  const { menuActions, tableActions, rowClickLabel, rowOpener } = resolveRowActions(props);
  const hasTableActions = tableActions !== undefined && tableActions.length > 0;
  const isEmpty = isEmptyTable(props);
  const expansionIdPrefix = useId();
  const rowTestId = (row: ListRowViewModel): string => getRowTestId?.(row) ?? `row-${row.id}`;
  const expansion = resolveRowExpansion(props);
  const isRowExpandable = expansion !== undefined;
  const fillsHeight = scrollBody === true;
  const insideEmbeddedScreen = useIsEmbeddedScreen();
  const selection = useBulkSelection({
    bulk,
    rows,
    titleField: schemaColumns[0]?.field,
    rowTestId,
    flush: fillsHeight,
  });
  const { headerRowRef, measured } = useMeasuredColumnWidths(
    isPinningActive(view, isNarrow) || isResizingActive(view, isNarrow),
  );
  const pins = useColumnPins({
    columns: viewColumns,
    view,
    isNarrow,
    measured,
    hasActionsColumn: hasTableActions,
    hasExpandColumn: isRowExpandable,
    hasSelectColumn: selection.active,
    fillsHeight,
  });
  const columns = pins.columns;
  const sizing = useColumnSizing({
    columns,
    view,
    isNarrow,
    measured,
    hasExpandColumn: isRowExpandable,
    hasSelectColumn: selection.active,
  });
  const fullColSpan =
    columns.length + [isRowExpandable, hasTableActions, selection.active].filter(Boolean).length;
  const tableItems = buildDataTableItems(rows, serverGroups);
  const keyboardRow = useRowKeyboardNavigation({
    view,
    isNarrow,
    rowIds: tableItems.flatMap((item) => (item.kind === "row" ? [item.row.id] : [])),
    onSelect: selection.onKeyboardSelect,
  });
  const schemaColumnByField = new Map(schemaColumns.map((col) => [col.field, col]));
  return {
    ...props,
    schemaColumns,
    columns,
    tableTranslate,
    tableLocale,
    isNarrow,
    density,
    facetsOpenNarrow,
    setFacetsOpenNarrow,
    menuActions,
    tableActions,
    rowClickLabel,
    rowOpener,
    hasTableActions,
    isEmpty,
    rowTestId,
    expansion,
    fillsHeight,
    insideEmbeddedScreen,
    selection,
    headerRowRef,
    pins,
    sizing,
    fullColSpan,
    expansionDomId: (row) => `${expansionIdPrefix}-${row.id}`,
    tableItems,
    keyboardRow,
    columnOf: (field) => schemaColumnByField.get(field),
  };
}

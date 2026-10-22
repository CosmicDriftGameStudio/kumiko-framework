import { cardColumnRoles } from "@cosmicdrift/kumiko-framework/ui-types";
import { ChevronRight, Search, SlidersHorizontal } from "lucide-react";
import { Fragment, type ReactNode, useId, useState } from "react";
import type { ListRowViewModel } from "../../headless/index.ts";
import { type DataTableProps, useOptionalLocale, useOptionalTranslation } from "../../index.ts";
import { UNIFORM_BAR_CONTROLS_CLASSES } from "../layout/uniform-bar-controls.ts";
import { cn } from "../lib/cn.ts";
import { Button as UiButton } from "../ui/button.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table.tsx";
import { CardLeadingImage } from "./file-thumbnail.tsx";
import { screenPaddingClassName } from "./layout.tsx";
import { useIsNarrowViewport } from "./use-narrow-viewport.ts";
import "../react-css-custom-properties.ts";
import { ActionsBodyCell, ActionsHeaderCell } from "./data-table/actions-column.tsx";
import { CardSortSelect } from "./data-table/card-sort-select.tsx";
import { isPinningActive, isResizingActive } from "./data-table/column-layout-mode.ts";
import { ColumnResizeHandle, ColumnWidthGroup } from "./data-table/column-resize-handle.tsx";
import { densityClasses } from "./data-table/density.ts";
import { buildFacetCluster } from "./data-table/facet-cluster.tsx";
import {
  bandClassName,
  bandReactKey,
  bandTestId,
  buildDataTableItems,
  type DataTableBandItem,
  GroupBand,
} from "./data-table/group-band.tsx";
import { useToggledRowGroups } from "./data-table/row-group-toggle.tsx";
import { SortableHeader } from "./data-table/sortable-header.tsx";
import {
  EXPAND_TOGGLE_CELL_CLASS,
  EXPANSION_CELL_CLASS,
  EXPANSION_CONTENT_CLASS,
  FILL_TABLE_CLASS,
  FlushTable,
  RowExpandToggle,
} from "./data-table/table-chrome.tsx";
import { DataTableFooter, showFullTextOnHover } from "./data-table/table-footer.tsx";
import { ToolbarEndCluster, toolbarEndHasContent } from "./data-table/toolbar-end-cluster.tsx";
import { TotalsCard, TotalsFooterRow } from "./data-table/totals-footer.tsx";
import { useBulkSelection } from "./data-table/use-bulk-selection.tsx";
import {
  EXPAND_COLUMN_KEY,
  SELECT_COLUMN_KEY,
  useColumnPins,
} from "./data-table/use-column-pins.ts";
import { useColumnSizing } from "./data-table/use-column-sizing.ts";
import { useMeasuredColumnWidths } from "./data-table/use-measured-column-widths.ts";
import { useRowKeyboardNavigation } from "./data-table/use-row-keyboard-navigation.ts";
import { useViewColumns } from "./data-table/use-view-columns.ts";
import {
  cellLinkProp,
  cellTitle,
  DataTableCell,
  FIT_CONTENT_CELL_CLASS,
  FirstCellLink,
  isBadgeColumn,
  isEmptyCellValue,
  isUnlabeledFalse,
  NUMERIC_COLUMN_TYPES,
  rowToneClass,
  showsBareCheckMark,
  TABULAR_COLUMN_TYPES,
} from "./data-table-cell.tsx";
import { InfiniteSentinel, Pager } from "./pager.tsx";
import { RowActionsCell } from "./row-actions.tsx";

export function DefaultDataTable({
  columns: schemaColumns,
  rows,
  onRowClick,
  sort,
  onSortChange,
  emptyState,
  toolbarStart,
  toolbarDescription,
  toolbarEnd,
  pager,
  onReachEnd,
  loadingMore,
  hasMore,
  itemNoun,
  rowActions,
  rowActionMode,
  bulk,
  rowGrouping,
  rowTone,
  filterFacets,
  filterValues,
  onFilterChange,
  onFilterReset,
  dateRangeFacets,
  onDateRangeChange,
  testId,
  onCellChange,
  getRowTestId,
  getCellTestId,
  chromeless,
  scrollBody,
  screenPadding,
  expandedRowIds,
  onToggleRowExpanded,
  renderExpandedRow,
  view,
  resetAll,
  exportList,
  serverGroups,
  totals,
  notice,
  rangeFacets,
  onRangeChange,
}: DataTableProps): ReactNode {
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
  const [toggledGroups, toggleGroup] = useToggledRowGroups();
  // Toolbar wrapper: shared container for toolbar + table so the two belong
  // together visually. The toolbar is NOT sticky: lists typically scroll with
  // the page container, not internally. Sticky would compete with the topbar.
  // The row click already runs rowClick actions, so with a clickable row they
  // must not reappear in the kebab (a list whose only action is the rowClick
  // one gets no actions column at all).
  const rowIsLink = onRowClick !== undefined;
  const menuActions =
    rowActions !== undefined && rowIsLink
      ? rowActions.filter((action) => action.rowClick !== true)
      : rowActions;
  // The table keeps every action in "inline" mode, and with editable cells the
  // first cell is not a keyboard link (FirstCellLink is off), so the kebab is
  // then the only keyboard route to the rowClick action.
  const tableActions =
    rowActionMode === "inline" || onCellChange !== undefined ? rowActions : menuActions;
  const rowClickAction = rowActions?.find((action) => action.rowClick === true);
  const rowClickLabel = rowClickAction?.label;
  const rowClickIsHidden = (row: ListRowViewModel): boolean =>
    rowClickAction?.isVisible !== undefined && !rowClickAction.isVisible(row);
  const hasTableActions = tableActions !== undefined && tableActions.length > 0;
  const isEmpty = rows.length === 0 && (serverGroups?.groups.length ?? 0) === 0;
  const expansionIdPrefix = useId();
  const rowTestId = (row: ListRowViewModel): string => getRowTestId?.(row) ?? `row-${row.id}`;
  const isRowExpandable = renderExpandedRow !== undefined && onToggleRowExpanded !== undefined;
  const fillsHeight = scrollBody === true;
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
  const expansionDomId = (row: ListRowViewModel): string => `${expansionIdPrefix}-${row.id}`;
  // The expand toggle of a row, shared by table and card layout. Named after
  // the first data column, the one a user recognizes the row by.
  function renderExpandToggle(row: ListRowViewModel): ReactNode {
    if (!isRowExpandable) return null;
    const expanded = expandedRowIds?.has(row.id) === true;
    const firstColumn = columns[0];
    const title =
      (firstColumn !== undefined ? cellTitle(row.values[firstColumn.field]) : undefined) ?? "";
    const labelKey = expanded ? "kumiko.list.row.collapse" : "kumiko.list.row.expand";
    return (
      <RowExpandToggle
        expanded={expanded}
        controlsId={expansionDomId(row)}
        label={
          tableTranslate?.(labelKey, { title }) ?? `${expanded ? "Collapse" : "Expand"} ${title}`
        }
        onToggle={() => onToggleRowExpanded(row.id)}
        testId={`${rowTestId(row)}-toggle`}
      />
    );
  }
  function renderExpansion(row: ListRowViewModel, as: "row" | "item", colSpan: number): ReactNode {
    if (!isRowExpandable || expandedRowIds?.has(row.id) !== true) return null;
    const content = renderExpandedRow(row);
    if (as === "item") {
      return (
        <li
          id={expansionDomId(row)}
          data-testid={`${rowTestId(row)}-expansion`}
          className="border-b border-border-row bg-muted px-4 pt-1 pb-3.5"
        >
          {content}
        </li>
      );
    }
    return (
      <TableRow
        id={expansionDomId(row)}
        data-testid={`${rowTestId(row)}-expansion`}
        className="hover:bg-transparent"
      >
        <TableCell colSpan={colSpan} className={EXPANSION_CELL_CLASS}>
          <div className={EXPANSION_CONTENT_CLASS}>{content}</div>
        </TableCell>
      </TableRow>
    );
  }
  const TableRoot = fillsHeight ? FlushTable : Table;
  const emptyBlock: ReactNode = (
    <div
      data-testid={testId !== undefined ? `${testId}-empty` : "render-list-empty"}
      className={cn(
        "flex flex-col items-center justify-center p-12 text-sm text-muted-foreground gap-3",
        chromeless !== true && !fillsHeight && "rounded-md border border-dashed",
      )}
    >
      {emptyState ?? <span>{tableTranslate?.("kumiko.list.no-entries") ?? "No entries."}</span>}
    </div>
  );

  const tableItems = buildDataTableItems(rows, rowGrouping, toggledGroups, serverGroups);
  const keyboardRow = useRowKeyboardNavigation({
    view,
    isNarrow,
    rowIds: tableItems.flatMap((item) => (item.kind === "row" ? [item.row.id] : [])),
    onSelect: selection.onKeyboardSelect,
  });

  const schemaColumnByField = new Map(schemaColumns.map((col) => [col.field, col]));
  const columnOf = (field: string) => schemaColumnByField.get(field);
  function renderBand(item: DataTableBandItem): ReactNode {
    return <GroupBand item={item} columnOf={columnOf} onClientToggle={toggleGroup} />;
  }

  function tableInner(): ReactNode {
    if (isEmpty) return emptyBlock;
    const expandHeaderPin = pins.headerCell(EXPAND_COLUMN_KEY);
    const expandBodyPin = pins.bodyCell(EXPAND_COLUMN_KEY);
    return (
      // dashboard-01 pattern: `rounded-lg border` frame, the header row
      // carries the bg-muted gray. `bg-card` (instead of transparent) -> the list
      // sits on the same card surface as forms; on themes with a colored page
      // background (e.g. cream) lists would otherwise not match the cards.
      // `chromeless` drops that frame for a host with its own boundary already (a tab panel).
      // `scrollBody`: the scroll surface and its border live on the wrapper
      // in `content` below, so the table renders frameless and without the
      // vendored `overflow-x-auto` container — that container would become
      // the sticky header's scrollport and the header would never stick.
      <div
        className={cn(
          !fillsHeight && "overflow-hidden",
          !fillsHeight && chromeless !== true && "rounded-lg border bg-card",
        )}
      >
        <TableRoot
          data-testid={testId}
          className={fillsHeight ? FILL_TABLE_CLASS : undefined}
          {...(sizing !== undefined && { style: sizing.tableStyle })}
        >
          {sizing !== undefined && (
            <ColumnWidthGroup
              fields={columns.map((col) => col.field)}
              sizing={sizing}
              hasExpandColumn={isRowExpandable}
              hasSelectColumn={selection.active}
              hasActionsColumn={hasTableActions}
            />
          )}
          <TableHeader className="bg-muted">
            <TableRow ref={headerRowRef} className="hover:bg-transparent">
              {selection.headerCell(pins.headerCell(SELECT_COLUMN_KEY))}
              {isRowExpandable && (
                <TableHead
                  data-testid="column-expand"
                  className={cn(EXPAND_TOGGLE_CELL_CLASS, expandHeaderPin.className)}
                  style={expandHeaderPin.style}
                />
              )}
              {columns.map((col) => {
                const headerPin = pins.headerCell(col.field);
                return (
                  <SortableHeader
                    key={col.field}
                    field={col.field}
                    label={col.label}
                    sortable={col.sortable === true}
                    highlighted={col.highlighted === true}
                    numeric={NUMERIC_COLUMN_TYPES.has(col.type)}
                    fitContent={col.fileDisplay !== undefined}
                    className={cn(density.header, headerPin.className)}
                    style={headerPin.style}
                    columnField={headerPin.columnField}
                    trailing={
                      sizing && (
                        <ColumnResizeHandle field={col.field} label={col.label} sizing={sizing} />
                      )
                    }
                    {...(sort !== undefined && sort !== null && { sort })}
                    {...(onSortChange !== undefined && { onSortChange })}
                  />
                );
              })}
              {hasTableActions && (
                <ActionsHeaderCell
                  label={tableTranslate?.("kumiko.list.actions") ?? "Actions"}
                  style={pins.actionsHeaderStyle}
                  absorbsLeftover={sizing !== undefined}
                />
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {tableItems.map((item) => {
              if (item.kind !== "row") {
                return (
                  <TableRow key={bandReactKey(item)} data-testid={bandTestId(item)}>
                    <TableCell colSpan={fullColSpan} className={bandClassName(item)}>
                      {renderBand(item)}
                    </TableCell>
                  </TableRow>
                );
              }
              const row = item.row;
              const opensOnClick = rowIsLink && !rowClickIsHidden(row);
              const keyboard = keyboardRow(
                row.id,
                opensOnClick ? () => onRowClick(row) : undefined,
              );
              return (
                <Fragment key={row.id}>
                  <TableRow
                    data-testid={rowTestId(row)}
                    data-tone={rowTone?.(row)}
                    onClick={opensOnClick ? () => onRowClick(row) : undefined}
                    className={cn(
                      rowToneClass(rowTone?.(row)),
                      opensOnClick && "cursor-pointer",
                      fillsHeight && "h-10 border-border-row hover:bg-muted",
                      density.row,
                      keyboard.className,
                    )}
                    {...keyboard.props}
                  >
                    {selection.bodyCell(row, pins.bodyCell(SELECT_COLUMN_KEY))}
                    {isRowExpandable && (
                      <TableCell
                        data-testid={getCellTestId?.(row, "expand") ?? `cell-${row.id}-expand`}
                        className={cn(EXPAND_TOGGLE_CELL_CLASS, expandBodyPin.className)}
                        style={expandBodyPin.style}
                      >
                        {renderExpandToggle(row)}
                      </TableCell>
                    )}
                    {columns.map((col, colIndex) => {
                      const bodyPin = pins.bodyCell(col.field);
                      return (
                        <TableCell
                          key={col.field}
                          data-testid={
                            getCellTestId?.(row, col.field) ?? `cell-${row.id}-${col.field}`
                          }
                          data-highlighted={col.highlighted === true ? "true" : undefined}
                          // Text wraps instead of truncating: nowrap cells keep their
                          // full width, so a wide table scrolled sideways and its
                          // last column slid under the sticky actions column with
                          // nothing visibly cut off. max-w-xs bounds a single column;
                          // badges and dates stay nowrap by their own classes.
                          className={cn(
                            col.fileDisplay === undefined
                              ? cn(
                                  sizing ? "overflow-hidden" : "max-w-xs",
                                  "whitespace-normal break-words",
                                )
                              : FIT_CONTENT_CELL_CLASS,
                            colIndex === 0
                              ? "font-medium text-foreground"
                              : "text-foreground-secondary",
                            NUMERIC_COLUMN_TYPES.has(col.type) && "text-right",
                            TABULAR_COLUMN_TYPES.has(col.type) && "tabular-nums",
                            col.highlighted === true && "bg-accent/40",
                            density.cell,
                            bodyPin.className,
                          )}
                          style={bodyPin.style}
                          title={cellTitle(row.values[col.field])}
                        >
                          <FirstCellLink
                            enabled={colIndex === 0 && opensOnClick && onCellChange === undefined}
                            onOpen={() => onRowClick?.(row)}
                            empty={isEmptyCellValue(row.values[col.field])}
                            emptyLabel={rowClickLabel}
                          >
                            <DataTableCell
                              value={row.values[col.field]}
                              row={row.values}
                              field={col.field}
                              type={col.type}
                              renderer={col.renderer}
                              translate={tableTranslate}
                              locale={tableLocale}
                              {...(col.optionLabels !== undefined && {
                                optionLabels: col.optionLabels,
                              })}
                              {...(col.optionTones !== undefined && {
                                optionTones: col.optionTones,
                              })}
                              {...(col.grouping !== undefined && { grouping: col.grouping })}
                              {...(col.fileDisplay !== undefined && {
                                fileDisplay: col.fileDisplay,
                              })}
                              {...(onCellChange !== undefined && {
                                onChange: (value: unknown) =>
                                  onCellChange(row.id, col.field, value),
                              })}
                              {...cellLinkProp(
                                col,
                                row,
                                !(colIndex === 0 && opensOnClick && onCellChange === undefined),
                              )}
                            />
                          </FirstCellLink>
                        </TableCell>
                      );
                    })}
                    {hasTableActions && (
                      <ActionsBodyCell
                        testId={getCellTestId?.(row, "actions") ?? `cell-${row.id}-actions`}
                        fillsHeight={fillsHeight}
                        measureContent={sizing !== undefined}
                      >
                        <RowActionsCell
                          row={row}
                          actions={tableActions}
                          mode={rowActionMode}
                          rowIsLink={rowIsLink}
                        />
                      </ActionsBodyCell>
                    )}
                  </TableRow>
                  {renderExpansion(row, "row", fullColSpan)}
                </Fragment>
              );
            })}
          </TableBody>
          {totals !== undefined && (
            <TotalsFooterRow
              totals={totals}
              columns={columns}
              cellPin={pins.bodyCell}
              leadingCells={[isRowExpandable, selection.active].filter(Boolean).length}
              trailingCells={hasTableActions ? 1 : 0}
              cellClassName={density.cell}
            />
          )}
        </TableRoot>
      </div>
    );
  }

  const {
    image: cardImageColumn,
    title: cardTitleColumn,
    status: cardStatusColumn,
    meta: cardMetaColumns,
  } = cardColumnRoles(columns);

  function cardCell(row: ListRowViewModel, col: (typeof columns)[number]): ReactNode {
    // A bare check mark in the subtitle line says nothing without its column.
    if (showsBareCheckMark(col.type, row.values[col.field], col.renderer)) return col.label;
    return (
      <DataTableCell
        value={row.values[col.field]}
        row={row.values}
        field={col.field}
        type={col.type}
        renderer={col.renderer}
        translate={tableTranslate}
        locale={tableLocale}
        {...(col.optionLabels !== undefined && { optionLabels: col.optionLabels })}
        {...(col.optionTones !== undefined && { optionTones: col.optionTones })}
        {...(col.grouping !== undefined && { grouping: col.grouping })}
        {...(col.fileDisplay !== undefined && { fileDisplay: col.fileDisplay, compactFile: true })}
        {...(onCellChange !== undefined && {
          onChange: (value: unknown) => onCellChange(row.id, col.field, value),
        })}
        {...cellLinkProp(col, row, !(rowIsLink && !rowClickIsHidden(row)))}
      />
    );
  }

  function renderCard(row: ListRowViewModel): ReactNode {
    const metaColumns = cardMetaColumns.filter(
      (col) =>
        !isEmptyCellValue(row.values[col.field]) &&
        !isUnlabeledFalse(col.type, row.values[col.field], col.renderer),
    );
    const showStatus =
      cardStatusColumn !== undefined && !isEmptyCellValue(row.values[cardStatusColumn.field]);
    const hasMenu = menuActions !== undefined && menuActions.length > 0;
    const opensOnClick = rowIsLink && !rowClickIsHidden(row);
    const body = (
      <>
        {cardImageColumn?.fileDisplay !== undefined && (
          <div data-testid={`card-image-${row.id}`} className="shrink-0">
            <CardLeadingImage
              value={row.values[cardImageColumn.field]}
              display={cardImageColumn.fileDisplay}
            />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            {cardTitleColumn !== undefined && (
              <span
                data-testid={
                  getCellTestId?.(row, cardTitleColumn.field) ??
                  `cell-${row.id}-${cardTitleColumn.field}`
                }
                className="min-w-0 break-words text-base font-semibold text-foreground"
              >
                {cardCell(row, cardTitleColumn)}
              </span>
            )}
            {showStatus && (
              <span
                data-testid={
                  getCellTestId?.(row, cardStatusColumn.field) ??
                  `cell-${row.id}-${cardStatusColumn.field}`
                }
                className="shrink-0"
              >
                {cardCell(row, cardStatusColumn)}
              </span>
            )}
          </div>
          {metaColumns.length > 0 && (
            // The separator is a real element, not CSS `content`. The row is shifted by one
            // separator width via logical `-ms-3` (RTL-safe); the wrapper clips only
            // horizontally (`overflow-x-clip`), so the separator vanishes at each line
            // start while nothing is hidden vertically.
            <div className="min-w-0 overflow-x-clip">
              <div
                data-testid={`card-meta-${row.id}`}
                className="-ms-3 flex min-w-0 flex-wrap items-center text-[13px] leading-5 tabular-nums text-foreground-secondary"
              >
                {metaColumns.map((col) => (
                  <div key={col.field} className="flex h-5 min-w-0 max-w-full items-center">
                    <span aria-hidden="true" className="w-3 shrink-0 text-center">
                      ·
                    </span>
                    <div
                      data-testid={getCellTestId?.(row, col.field) ?? `cell-${row.id}-${col.field}`}
                      className="min-w-0 truncate leading-5"
                      onPointerEnter={showFullTextOnHover}
                    >
                      {isBadgeColumn(col) ? (
                        <span className="inline-flex align-middle">{cardCell(row, col)}</span>
                      ) : (
                        cardCell(row, col)
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        {opensOnClick && (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
      </>
    );
    const rowItem = (
      <li
        key={row.id}
        data-testid={rowTestId(row)}
        data-tone={rowTone?.(row)}
        className={cn(
          "flex min-h-[72px] items-center gap-2 border-b border-border-row py-3",
          rowToneClass(rowTone?.(row)),
          isRowExpandable || selection.active ? "pl-2" : "pl-4",
          hasMenu ? "pr-2" : "pr-4",
          density.card,
        )}
        {...(opensOnClick && { onClick: () => onRowClick(row) })}
      >
        {selection.cardCheckbox(row)}
        {renderExpandToggle(row)}
        {opensOnClick ? (
          <button
            type="button"
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 bg-transparent p-0 text-left"
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              e.stopPropagation();
              onRowClick(row);
            }}
          >
            {body}
          </button>
        ) : (
          body
        )}
        {hasMenu && (
          // biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation only — not a control
          <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <RowActionsCell
              row={row}
              actions={menuActions}
              mode={rowActionMode}
              rowIsLink={rowIsLink}
              compact
            />
          </div>
        )}
      </li>
    );
    if (!isRowExpandable) return rowItem;
    // The expansion is a sibling <li>, outside the row's click target, so
    // clicks in the sub-area never navigate the parent row.
    return (
      <Fragment key={row.id}>
        {rowItem}
        {renderExpansion(row, "item", 0)}
      </Fragment>
    );
  }

  function cardsInner(): ReactNode {
    if (isEmpty) return emptyBlock;
    return (
      <div data-testid={testId} className="contents">
        <div
          data-testid={testId !== undefined ? `${testId}-cards` : "render-list-cards"}
          className="flex flex-col"
        >
          <CardSortSelect
            columns={columns}
            sort={sort}
            onSortChange={onSortChange}
            testId={testId}
          />
          <ul className="m-0 list-none border-t border-border-row p-0">
            {tableItems.map((item) =>
              item.kind === "row" ? (
                renderCard(item.row)
              ) : (
                <li
                  key={bandReactKey(item)}
                  data-testid={bandTestId(item)}
                  className={cn("border-b border-border-row", bandClassName(item))}
                >
                  {renderBand(item)}
                </li>
              ),
            )}
          </ul>
          {totals !== undefined && <TotalsCard totals={totals} columnOf={columnOf} />}
        </div>
      </div>
    );
  }

  const tableContent = isNarrow ? cardsInner() : tableInner();

  // The pager is ALWAYS rendered below the table (even with rows=[]) so the
  // user can page back on a filter hit of zero without losing the list.
  // Except total === 0: then there is nothing to paginate. Incompatible with
  // infinite scroll: the caller sets either pager OR onReachEnd.
  const pagerElement =
    pager !== undefined && pager.total > 0 && serverGroups === undefined ? (
      <Pager
        page={pager.page}
        limit={pager.limit}
        total={pager.total}
        onPageChange={pager.onPageChange}
        {...(pager.pageSizeOptions !== undefined && { pageSizeOptions: pager.pageSizeOptions })}
        {...(pager.onPageSizeChange !== undefined && { onPageSizeChange: pager.onPageSizeChange })}
        {...(itemNoun !== undefined && { itemNoun })}
        testId={testId !== undefined ? `${testId}-pager` : "render-list-pager"}
        pinned={fillsHeight}
      />
    ) : undefined;
  const sentinelElement =
    pagerElement === undefined && onReachEnd !== undefined && serverGroups === undefined ? (
      <InfiniteSentinel
        onReachEnd={onReachEnd}
        loadingMore={loadingMore === true}
        hasMore={hasMore !== false}
        rowsCount={rows.length}
        testId={testId !== undefined ? `${testId}-sentinel` : "render-list-sentinel"}
      />
    ) : undefined;

  // With scrollBody the footer (pager, else the entry count) sits OUTSIDE the
  // scroll surface so it stays put at any row count; the infinite sentinel
  // stays INSIDE, or it would never intersect the scrollport.
  const content = fillsHeight ? (
    <>
      {selection.bar}
      <div
        data-testid={testId !== undefined ? `${testId}-scroll` : "render-list-scroll"}
        className="min-h-0 flex-1 overflow-auto border-t border-border bg-card"
      >
        {tableContent}
        {sentinelElement}
      </div>
      {pagerElement ?? (
        <DataTableFooter
          count={serverGroups?.totalCount ?? rows.length}
          {...(itemNoun !== undefined && { itemNoun })}
          testId={testId !== undefined ? `${testId}-footer` : "render-list-footer"}
        />
      )}
    </>
  ) : (
    <>
      {selection.bar}
      {tableContent}
      {pagerElement}
      {sentinelElement}
    </>
  );

  const facetCluster = buildFacetCluster({
    filterFacets,
    filterValues,
    onFilterChange,
    onFilterReset,
    dateRangeFacets,
    onDateRangeChange,
    rangeFacets,
    onRangeChange,
    resetAll,
    notice,
    dense: fillsHeight,
  });

  const columnLabels = new Map(schemaColumns.map((col) => [col.field, col.label]));

  const collapsesFacetsBehindButton = isNarrow && fillsHeight && facetCluster !== undefined;
  const hasToolbar =
    toolbarStart !== undefined ||
    facetCluster !== undefined ||
    toolbarEndHasContent(view, exportList, toolbarEnd);

  // dashboard-01 pattern: the toolbar (search + facets + "+ New") sits ABOVE
  // the table in the same padding block; no separate bg bar, no screen title
  // (that lives in the shell's breadcrumb).
  return (
    // `screenPadding`: on a list screen this wrapper IS the screen container,
    // so it takes the same token as FormScreenShell/PageSection instead of its
    // own inset — a list ends at the same footer distance as a form.
    // Explicit `false` (vs. the default/omitted case) means a host that
    // already pads its own children — a relatedList section nested in a
    // tabs-mode Card — so this wrapper adds no inset of its
    // own, or its content would sit ~24px deeper than sibling banners in the
    // same Card body.
    <div
      className={cn(
        "flex flex-col w-full",
        // scrollBody: the wrapper fills its container so the footer sits at the
        // same spot at 3 and 300 rows; the 24px insets live in toolbar, cells
        // and footer, so no outer padding.
        fillsHeight
          ? "h-full min-h-0"
          : cn(
              "gap-4",
              screenPadding === true
                ? screenPaddingClassName
                : screenPadding === false
                  ? undefined
                  : "p-6",
            ),
      )}
    >
      {hasToolbar && (
        <div
          data-testid={testId !== undefined ? `${testId}-toolbar` : "render-list-toolbar"}
          className={cn(
            "flex flex-wrap items-center",
            UNIFORM_BAR_CONTROLS_CLASSES,
            fillsHeight
              ? isNarrow
                ? "shrink-0 gap-2 p-3"
                : "min-h-13 shrink-0 gap-2 px-6 py-2 md:py-0"
              : "gap-3",
          )}
        >
          {/* min-w-48: without a floor, flex shrinks the search instead of wrapping the facet cluster onto its own line. */}
          {toolbarStart !== undefined && (
            <div
              className={cn(
                fillsHeight
                  ? "relative w-full md:w-[300px] max-md:flex-1 [&_input]:border-border-strong [&_input]:pl-8 [&_input]:max-md:h-11"
                  : "flex-1 min-w-48 max-w-sm",
              )}
            >
              {fillsHeight && (
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
              {toolbarStart}
            </div>
          )}
          {collapsesFacetsBehindButton ? (
            <>
              <UiButton
                type="button"
                variant="outline"
                size="icon"
                className="size-11"
                aria-label={tableTranslate?.("kumiko.list.filter.toggle") ?? "Filter"}
                aria-expanded={facetsOpenNarrow}
                data-testid={testId !== undefined ? `${testId}-filter-toggle` : "filter-toggle"}
                onClick={() => setFacetsOpenNarrow((open) => !open)}
              >
                <SlidersHorizontal className="size-4" aria-hidden="true" />
              </UiButton>
              {facetsOpenNarrow && <div className="w-full">{facetCluster}</div>}
            </>
          ) : (
            facetCluster
          )}
          <ToolbarEndCluster
            view={view}
            columnLabels={columnLabels}
            exportList={exportList}
            toolbarEnd={toolbarEnd}
          />
        </div>
      )}
      {toolbarDescription !== undefined && (
        <p
          data-testid={testId !== undefined ? `${testId}-description` : "render-list-description"}
          className={cn(
            "m-0 pb-2 text-sm text-muted-foreground",
            fillsHeight && (isNarrow ? "px-3" : "px-6"),
            fillsHeight && !hasToolbar && "pt-4",
          )}
        >
          {toolbarDescription}
        </p>
      )}
      {content}
    </div>
  );
}

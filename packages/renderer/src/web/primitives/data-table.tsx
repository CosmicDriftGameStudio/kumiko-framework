import { cardColumnRoles } from "@cosmicdrift/kumiko-framework/ui-types";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  Fragment,
  type PointerEvent,
  type ReactNode,
  type TableHTMLAttributes,
  useId,
  useState,
} from "react";
import type { ListRowViewModel } from "../../headless/index.ts";
import type { DataTableSortDir } from "../../index.ts";
import { type DataTableProps, useOptionalLocale, useOptionalTranslation } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { Button as UiButton } from "../ui/button.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table.tsx";
import { CardLeadingImage } from "./file-thumbnail.tsx";
import { screenPaddingClassName } from "./layout.tsx";
import { useIsNarrowViewport } from "./use-narrow-viewport.ts";
import "../react-css-custom-properties.ts";
import {
  buildTableItems,
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
  SortableHeader,
  showsBareCheckMark,
  TABULAR_COLUMN_TYPES,
  type TableItem,
} from "./data-table-cell.tsx";
import { DateRangeFacetFilter, FacetFilter } from "./facet-filter.tsx";
import { InfiniteSentinel, Pager, TABLE_FOOTER_BAR_CLASS } from "./pager.tsx";
import { RowActionsCell } from "./row-actions.tsx";

// The vendored Table wraps <table> in an `overflow-x-auto` container, which
// would become the scrollport of a sticky header. A scrollBody table scrolls
// in its parent instead, so it renders the bare <table>.
function FlushTable({ className, ...props }: TableHTMLAttributes<HTMLTableElement>): ReactNode {
  return (
    <table
      data-slot="table"
      className={cn("w-full caption-bottom text-sm", className)}
      {...props}
    />
  );
}

// Header cells stick to the scroll surface; the bottom rule is an inset
// shadow because a border on a sticky cell scrolls away under border-collapse.
// Column weight (medium vs. semibold for the sorted one) lives on the th itself
// in SortableHeader: a `[&_th]:font-*` rule here would outrank it.
// Child selectors only: an expanded row nests a whole table inside a cell, and
// descendant selectors would make its header sticky and re-pad its cells.
const FILL_TABLE_CLASS = cn(
  "[&>thead>tr>th]:sticky [&>thead>tr>th]:top-0 [&>thead>tr>th]:z-10 [&>thead>tr>th]:h-9 [&>thead>tr>th]:bg-muted [&>thead>tr>th]:px-2 [&>thead>tr>th]:text-[13px]",
  "[&>thead>tr>th]:shadow-[inset_0_-1px_0_var(--color-border)] [&>thead>tr>th_button]:text-[13px] [&>tbody>tr>td]:px-2 [&>tbody>tr>td]:py-0",
  "[&>*>tr>:first-child]:pl-6 [&>*>tr>:last-child]:pr-6",
);

// `!`: beats the first/last-child padding of FILL_TABLE_CLASS, which would
// otherwise widen the narrow toggle column / pad the full-width expansion cell.
// The nested table's sticky actions cell (last td) gets the muted surface
// instead of its own md:bg-background, so it blends into the area.
const EXPAND_TOGGLE_CELL_CLASS = "w-10 px-1! py-0!";

const EXPANSION_CELL_CLASS =
  "whitespace-normal bg-muted p-0! align-top md:[&_td:last-child]:bg-muted";

const EXPANSION_CONTENT_CLASS = "pt-1 pr-4 pb-3.5 pl-[52px]";

function RowExpandToggle({
  expanded,
  controlsId,
  label,
  onToggle,
  testId,
}: {
  readonly expanded: boolean;
  readonly controlsId: string;
  readonly label: string;
  readonly onToggle: () => void;
  readonly testId: string;
}): ReactNode {
  return (
    <UiButton
      type="button"
      variant="ghost"
      size="icon"
      className="size-8 shrink-0 max-md:size-11"
      aria-expanded={expanded}
      {...(expanded && { "aria-controls": controlsId })}
      aria-label={label}
      data-testid={testId}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <ChevronRight
        className={cn("size-4 transition-transform", expanded && "rotate-90")}
        aria-hidden="true"
      />
    </UiButton>
  );
}

function DataTableFooter({
  count,
  itemNoun,
  testId,
}: {
  readonly count: number;
  readonly itemNoun?: (count: number) => string;
  readonly testId: string;
}): ReactNode {
  const t = useOptionalTranslation();
  const noun = itemNoun?.(count);
  const label =
    noun !== undefined
      ? (t?.("kumiko.list.count.noun", { count: count.toLocaleString(), noun }) ??
        `${count.toLocaleString()} ${noun}`)
      : count === 1
        ? (t?.("kumiko.list.count.one") ?? "1 entry")
        : (t?.("kumiko.list.count.other", { count: count.toLocaleString() }) ??
          `${count.toLocaleString()} entries`);
  return (
    <div data-testid={testId} className={TABLE_FOOTER_BAR_CLASS}>
      <span data-testid={`${testId}-count`}>{label}</span>
    </div>
  );
}

// Cell content is a ReactNode, so the tooltip text is read from the rendered DOM.
function showFullTextOnHover(event: PointerEvent<HTMLElement>): void {
  const element = event.currentTarget;
  element.title = element.scrollWidth > element.clientWidth ? (element.textContent ?? "") : "";
}

export function DefaultDataTable({
  columns,
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
}: DataTableProps): ReactNode {
  // One locale/translate subscription per table — not per cell.
  // Optional hooks: a bare DataTable outside LocaleProvider must not crash.
  const tableTranslate = useOptionalTranslation();
  const tableLocale = useOptionalLocale();
  // Below 768px a table scrolls its columns out of reach with no visible
  // affordance. Cards replace the table entirely below the breakpoint — same
  // single-mount pattern as EmbeddedListInput/embedded-list-input.tsx.
  const isNarrow = useIsNarrowViewport();
  const [facetsOpenNarrow, setFacetsOpenNarrow] = useState(false);
  const [toggledGroups, setToggledGroups] = useState<ReadonlySet<string>>(new Set());
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
  const isEmpty = rows.length === 0;
  const expansionIdPrefix = useId();
  const isRowExpandable = renderExpandedRow !== undefined && onToggleRowExpanded !== undefined;
  const rowTestId = (row: ListRowViewModel): string => getRowTestId?.(row) ?? `row-${row.id}`;
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
  const fillsHeight = scrollBody === true;
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

  const tableItems = buildTableItems(rows, rowGrouping, toggledGroups);

  function renderGroupToggle(item: Extract<TableItem, { kind: "group" }>): ReactNode {
    return (
      <button
        type="button"
        aria-expanded={!item.collapsed}
        data-testid={`row-group-${item.key}-toggle`}
        onClick={() =>
          setToggledGroups((prev) => {
            const next = new Set(prev);
            if (!next.delete(item.key)) next.add(item.key);
            return next;
          })
        }
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium text-foreground-secondary"
      >
        {item.collapsed ? (
          <ChevronRight className="size-3.5" />
        ) : (
          <ChevronDown className="size-3.5" />
        )}
        {item.label}
      </button>
    );
  }

  function tableInner(): ReactNode {
    if (isEmpty) return emptyBlock;
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
        <TableRoot data-testid={testId} className={fillsHeight ? FILL_TABLE_CLASS : undefined}>
          <TableHeader className="bg-muted">
            <TableRow className="hover:bg-transparent">
              {isRowExpandable && (
                <TableHead data-testid="column-expand" className={EXPAND_TOGGLE_CELL_CLASS} />
              )}
              {columns.map((col) => (
                <SortableHeader
                  key={col.field}
                  field={col.field}
                  label={col.label}
                  sortable={col.sortable === true}
                  highlighted={col.highlighted === true}
                  numeric={NUMERIC_COLUMN_TYPES.has(col.type)}
                  fitContent={col.fileDisplay !== undefined}
                  {...(sort !== undefined && sort !== null && { sort })}
                  {...(onSortChange !== undefined && { onSortChange })}
                />
              ))}
              {hasTableActions && (
                <TableHead
                  data-testid="column-actions"
                  // From md: sticky right-0 + bg-muted (= header tone) so the
                  // action column stays at the right edge during horizontal
                  // scroll on wider screens. Below md, actions scroll in
                  // normal flow — sticky there would pin the column over the
                  // preceding data column instead of the (already narrow)
                  // page edge. No border-l: a permanent divider looks heavy;
                  // the sticky bg already sets the column apart during scroll.
                  className="w-px text-right text-muted-foreground md:sticky md:right-0 md:z-10 md:bg-muted"
                  aria-label={tableTranslate?.("kumiko.list.actions") ?? "Actions"}
                />
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {tableItems.map((item) => {
              if (item.kind === "group") {
                return (
                  <TableRow key={`group-${item.key}`} data-testid={`row-group-${item.key}`}>
                    <TableCell
                      colSpan={
                        columns.length + (isRowExpandable ? 1 : 0) + (hasTableActions ? 1 : 0)
                      }
                      className="bg-muted/40 p-0"
                    >
                      {renderGroupToggle(item)}
                    </TableCell>
                  </TableRow>
                );
              }
              const row = item.row;
              const opensOnClick = rowIsLink && !rowClickIsHidden(row);
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
                    )}
                  >
                    {isRowExpandable && (
                      <TableCell
                        data-testid={getCellTestId?.(row, "expand") ?? `cell-${row.id}-expand`}
                        className={EXPAND_TOGGLE_CELL_CLASS}
                      >
                        {renderExpandToggle(row)}
                      </TableCell>
                    )}
                    {columns.map((col, colIndex) => (
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
                            ? "max-w-xs whitespace-normal break-words"
                            : FIT_CONTENT_CELL_CLASS,
                          colIndex === 0
                            ? "font-medium text-foreground"
                            : "text-foreground-secondary",
                          NUMERIC_COLUMN_TYPES.has(col.type) && "text-right",
                          TABULAR_COLUMN_TYPES.has(col.type) && "tabular-nums",
                          col.highlighted === true && "bg-accent/40",
                        )}
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
                            {...(col.optionTones !== undefined && { optionTones: col.optionTones })}
                            {...(col.grouping !== undefined && { grouping: col.grouping })}
                            {...(col.fileDisplay !== undefined && { fileDisplay: col.fileDisplay })}
                            {...(onCellChange !== undefined && {
                              onChange: (value: unknown) => onCellChange(row.id, col.field, value),
                            })}
                            {...cellLinkProp(
                              col,
                              row,
                              !(colIndex === 0 && opensOnClick && onCellChange === undefined),
                            )}
                          />
                        </FirstCellLink>
                      </TableCell>
                    ))}
                    {hasTableActions && (
                      <TableCell
                        data-testid={getCellTestId?.(row, "actions") ?? `cell-${row.id}-actions`}
                        // From md: sticky-right so the actions stay visible on the
                        // right edge during horizontal scroll. Below md, actions
                        // scroll with the row like any other cell — sticky there
                        // would hide the neighboring data column on narrow
                        // viewports. bg-background sets the column apart during
                        // scroll — no border-l (divider too heavy).
                        className={cn(
                          "whitespace-nowrap text-right md:sticky md:right-0 md:z-10 md:bg-background",
                          fillsHeight && "md:bg-card",
                        )}
                        // Action-cell events must not trigger the row click/activation
                        // (typically "Open Detail" — the user wanted the action,
                        // not navigation). We stopPropagation for mouse and
                        // keyboard so a11y stays consistent.
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <RowActionsCell
                          row={row}
                          actions={tableActions}
                          mode={rowActionMode}
                          rowIsLink={rowIsLink}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                  {renderExpansion(
                    row,
                    "row",
                    columns.length + (isRowExpandable ? 1 : 0) + (hasTableActions ? 1 : 0),
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </TableRoot>
      </div>
    );
  }

  // No column headers below the breakpoint, so the click-to-sort affordance
  // on SortableHeader has nothing to attach to. A single native <select> is
  // the whole fix — no custom widget, no menu — fed straight from the
  // columns marked sortable in the ViewModel. Options carry the resolved
  // {field, dir} directly so onChange can look the pick up by value instead
  // of parsing/casting the option string back apart.
  const sortableColumns = columns.filter((col) => col.sortable);
  const sortOptions: readonly {
    readonly value: string;
    readonly field: string;
    readonly dir: DataTableSortDir;
    readonly label: string;
  }[] = sortableColumns.flatMap((col) => [
    { value: `${col.field}:asc`, field: col.field, dir: "asc", label: `${col.label} ↑` },
    { value: `${col.field}:desc`, field: col.field, dir: "desc", label: `${col.label} ↓` },
  ]);

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
          isRowExpandable ? "pl-2" : "pl-4",
          hasMenu ? "pr-2" : "pr-4",
        )}
        {...(opensOnClick && { onClick: () => onRowClick(row) })}
      >
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
    const sortLabel =
      sort !== undefined && sort !== null
        ? (tableTranslate?.("kumiko.list.sort.by", {
            column: columns.find((col) => col.field === sort.field)?.label ?? sort.field,
          }) ?? `Sorted by ${sort.field}`)
        : (tableTranslate?.("kumiko.list.sort.unsorted") ?? "Unsorted");
    const SortArrow = sort?.dir === "desc" ? ArrowDown : ArrowUp;
    // URL state can carry a sort on a column that is not sortable; without an
    // option for it the select would claim "Unsorted" while the list is sorted.
    const currentSortValue = sort !== undefined && sort !== null ? `${sort.field}:${sort.dir}` : "";
    const currentSortIsUnlisted =
      sort !== undefined && sort !== null && !sortOptions.some((o) => o.value === currentSortValue);
    return (
      <div data-testid={testId} className="contents">
        <div
          data-testid={testId !== undefined ? `${testId}-cards` : "render-list-cards"}
          className="flex flex-col"
        >
          {onSortChange !== undefined && sortableColumns.length > 0 && (
            <div className="relative flex h-9 items-center gap-1.5 px-4 text-[13px] text-foreground-secondary">
              <span aria-hidden="true">{sortLabel}</span>
              {sort !== undefined && sort !== null && (
                <SortArrow className="size-3.5" aria-hidden="true" />
              )}
              <select
                aria-label={tableTranslate?.("kumiko.list.sort.label") ?? "Sort"}
                data-testid={testId !== undefined ? `${testId}-sort` : "render-list-sort"}
                value={currentSortValue}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") {
                    onSortChange(null);
                    return;
                  }
                  const picked = sortOptions.find((o) => o.value === raw);
                  if (picked === undefined) return;
                  onSortChange({ field: picked.field, dir: picked.dir });
                }}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              >
                <option value="">
                  {tableTranslate?.("kumiko.list.sort.unsorted") ?? "Unsorted"}
                </option>
                {currentSortIsUnlisted && (
                  <option value={currentSortValue}>
                    {`${columns.find((col) => col.field === sort.field)?.label ?? sort.field} ${sort.dir === "desc" ? "↓" : "↑"}`}
                  </option>
                )}
                {sortOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <ul className="m-0 list-none border-t border-border-row p-0">
            {tableItems.map((item) =>
              item.kind === "group" ? (
                <li
                  key={`group-${item.key}`}
                  data-testid={`row-group-${item.key}`}
                  className="border-b border-border-row bg-muted/40"
                >
                  {renderGroupToggle(item)}
                </li>
              ) : (
                renderCard(item.row)
              ),
            )}
          </ul>
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
    pager !== undefined && pager.total > 0 ? (
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
    pagerElement === undefined && onReachEnd !== undefined ? (
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
      <div
        data-testid={testId !== undefined ? `${testId}-scroll` : "render-list-scroll"}
        className="min-h-0 flex-1 overflow-auto border-t border-border bg-card"
      >
        {tableContent}
        {sentinelElement}
      </div>
      {pagerElement ?? (
        <DataTableFooter
          count={rows.length}
          {...(itemNoun !== undefined && { itemNoun })}
          testId={testId !== undefined ? `${testId}-footer` : "render-list-footer"}
        />
      )}
    </>
  ) : (
    <>
      {tableContent}
      {pagerElement}
      {sentinelElement}
    </>
  );

  const hasFacets =
    filterFacets !== undefined && filterFacets.length > 0 && onFilterChange !== undefined;
  const hasDateRangeFacets =
    dateRangeFacets !== undefined && dateRangeFacets.length > 0 && onDateRangeChange !== undefined;
  const hasActiveFilters =
    filterValues !== undefined && Object.values(filterValues).some((v) => v.length > 0);
  const facetCluster =
    hasFacets || hasDateRangeFacets ? (
      <div className="flex flex-wrap items-center gap-2">
        {hasFacets &&
          filterFacets.map((facet) => (
            <FacetFilter
              key={facet.field}
              facet={facet}
              selected={filterValues?.[facet.field] ?? []}
              onChange={onFilterChange}
              dense={fillsHeight}
            />
          ))}
        {hasDateRangeFacets &&
          dateRangeFacets.map((facet) => (
            <DateRangeFacetFilter key={facet.field} facet={facet} onChange={onDateRangeChange} />
          ))}
        {hasActiveFilters && onFilterReset !== undefined && (
          <UiButton
            variant="ghost"
            size="sm"
            className="h-9 px-2"
            onClick={onFilterReset}
            data-testid="facet-reset"
          >
            {tableTranslate?.("kumiko.list.filter.reset") ?? "Reset"}
            <X />
          </UiButton>
        )}
      </div>
    ) : undefined;

  const collapsesFacetsBehindButton = isNarrow && fillsHeight && facetCluster !== undefined;
  const hasToolbar =
    toolbarStart !== undefined || toolbarEnd !== undefined || facetCluster !== undefined;

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
                  ? "relative w-full md:w-[300px] max-md:flex-1 [&_input]:border-border-strong [&_input]:pl-8 [&_input]:max-md:h-11 md:[&_input]:h-8"
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
          {toolbarEnd !== undefined && (
            <div className="flex flex-wrap items-center gap-2 ml-auto">{toolbarEnd}</div>
          )}
        </div>
      )}
      {toolbarDescription !== undefined && (
        <p
          data-testid={testId !== undefined ? `${testId}-description` : "render-list-description"}
          className={cn(
            "m-0 pb-2 text-sm text-muted-foreground",
            fillsHeight && (isNarrow ? "px-3" : "px-6"),
          )}
        >
          {toolbarDescription}
        </p>
      )}
      {content}
    </div>
  );
}

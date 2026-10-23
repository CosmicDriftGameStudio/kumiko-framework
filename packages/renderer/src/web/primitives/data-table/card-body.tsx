import type { cardColumnRoles } from "@cosmicdrift/kumiko-framework/ui-types";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import type { ListColumnViewModel, ListRowViewModel } from "../../../headless/index.ts";
import {
  cellLinkProp,
  DataTableCell,
  isBadgeColumn,
  isEmptyCellValue,
  isUnlabeledFalse,
  showsBareCheckMark,
} from "../data-table-cell.tsx";
import { CardLeadingImage } from "../file-thumbnail.tsx";
import { columnCellPresentationProps } from "./data-cell-props.ts";
import { showFullTextOnHover } from "./table-footer.tsx";
import type { DataTableModel } from "./use-data-table-state.ts";

export type CardRoles = ReturnType<typeof cardColumnRoles<ListColumnViewModel>>;

function cardCell(m: DataTableModel, row: ListRowViewModel, col: ListColumnViewModel): ReactNode {
  const { onCellChange } = m;
  // A bare check mark in the subtitle line says nothing without its column.
  if (showsBareCheckMark(col.type, row.values[col.field], col.renderer)) return col.label;
  return (
    <DataTableCell
      value={row.values[col.field]}
      row={row.values}
      field={col.field}
      type={col.type}
      renderer={col.renderer}
      translate={m.tableTranslate}
      locale={m.tableLocale}
      {...columnCellPresentationProps(col)}
      {...(col.fileDisplay !== undefined && { fileDisplay: col.fileDisplay, compactFile: true })}
      {...(onCellChange !== undefined && {
        onChange: (value: unknown) => onCellChange(row.id, col.field, value),
      })}
      {...cellLinkProp(col, row, m.rowOpener(row) === undefined)}
    />
  );
}

function cellTestIdOf(m: DataTableModel, row: ListRowViewModel, field: string): string {
  return m.getCellTestId?.(row, field) ?? `cell-${row.id}-${field}`;
}

function renderCardMeta(
  m: DataTableModel,
  row: ListRowViewModel,
  metaColumns: readonly ListColumnViewModel[],
): ReactNode {
  return (
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
              data-testid={cellTestIdOf(m, row, col.field)}
              className="min-w-0 truncate leading-5"
              onPointerEnter={showFullTextOnHover}
            >
              {isBadgeColumn(col) ? (
                <span className="inline-flex align-middle">{cardCell(m, row, col)}</span>
              ) : (
                cardCell(m, row, col)
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function renderCardHeading(m: DataTableModel, row: ListRowViewModel, roles: CardRoles): ReactNode {
  const { title: cardTitleColumn, status: cardStatusColumn } = roles;
  const showStatus =
    cardStatusColumn !== undefined && !isEmptyCellValue(row.values[cardStatusColumn.field]);
  return (
    <div className="flex min-w-0 items-start justify-between gap-2">
      {cardTitleColumn !== undefined && (
        <span
          data-testid={cellTestIdOf(m, row, cardTitleColumn.field)}
          className="min-w-0 truncate text-base font-semibold text-foreground"
          onPointerEnter={showFullTextOnHover}
        >
          {cardCell(m, row, cardTitleColumn)}
        </span>
      )}
      {showStatus && (
        <span data-testid={cellTestIdOf(m, row, cardStatusColumn.field)} className="shrink-0">
          {cardCell(m, row, cardStatusColumn)}
        </span>
      )}
    </div>
  );
}

export function renderCardBody(
  m: DataTableModel,
  row: ListRowViewModel,
  roles: CardRoles,
): ReactNode {
  const { image: cardImageColumn, meta: cardMetaColumns } = roles;
  const metaColumns = cardMetaColumns.filter(
    (col) =>
      !isEmptyCellValue(row.values[col.field]) &&
      !isUnlabeledFalse(col.type, row.values[col.field], col.renderer),
  );
  return (
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
        {renderCardHeading(m, row, roles)}
        {metaColumns.length > 0 && renderCardMeta(m, row, metaColumns)}
      </div>
      {m.rowOpener(row) !== undefined && (
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
    </>
  );
}

import { type cardColumnRoles, cardMetaLines } from "@cosmicdrift/kumiko-framework/ui-types";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import type {
  ListColumnHintViewModel,
  ListColumnViewModel,
  ListRowViewModel,
} from "../../../headless/index.ts";
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

// The phone card shows the sentence and its (narrow) detail; the reason toggle stays a table feature.
function cardHint(hint: ListColumnHintViewModel): ListColumnHintViewModel {
  const {
    reasonField: _reason,
    reasonOpenField: _reasonOpen,
    reasonTitleField: _reasonTitle,
    detailField: _detail,
    narrowDetailField,
    narrowField: _narrowField,
    ...rest
  } = hint;
  const detailField = narrowDetailField ?? _detail;
  return { ...rest, ...(detailField !== undefined && { detailField }) };
}

function cardCell(
  m: DataTableModel,
  row: ListRowViewModel,
  col: ListColumnViewModel,
  { linksAllowed }: { readonly linksAllowed: boolean } = { linksAllowed: false },
): ReactNode {
  const { onCellChange } = m;
  const opensRow = m.rowOpener(row) !== undefined;
  // A bare check mark in the subtitle line says nothing without its column.
  if (showsBareCheckMark(col.type, row.values[col.field], col.renderer)) return col.label;
  const shortSentence =
    col.hint?.narrowField === undefined ? undefined : row.values[col.hint.narrowField];
  return (
    <DataTableCell
      value={isEmptyCellValue(shortSentence) ? row.values[col.field] : shortSentence}
      row={row.values}
      field={col.field}
      type={col.type}
      renderer={col.renderer}
      translate={m.tableTranslate}
      locale={m.tableLocale}
      {...columnCellPresentationProps(col)}
      {...(col.hint !== undefined && { hint: cardHint(col.hint) })}
      {...(col.fileDisplay !== undefined && { fileDisplay: col.fileDisplay, compactFile: true })}
      {...(onCellChange !== undefined && {
        onChange: (value: unknown) => onCellChange(row.id, col.field, value),
      })}
      {...(col.rowActionLink === true &&
        col.display === undefined && { display: "button" as const })}
      {...cellLinkProp(col, row, linksAllowed || !opensRow)}
    />
  );
}

function cellTestIdOf(m: DataTableModel, row: ListRowViewModel, field: string): string {
  return m.getCellTestId?.(row, field) ?? `cell-${row.id}-${field}`;
}

function hasCardLink(row: ListRowViewModel, col: ListColumnViewModel): boolean {
  return (
    !isEmptyCellValue(row.values[col.field]) && cellLinkProp(col, row, true).link !== undefined
  );
}

function needsControlOutsideOpener(row: ListRowViewModel, col: ListColumnViewModel): boolean {
  return hasCardLink(row, col);
}

// A link inside the row's opener button would be an <a> or <button> in a
// <button>, so such columns of an openable card move out of the body and render below it.
export function splitLinkColumns(
  m: DataTableModel,
  row: ListRowViewModel,
  roles: CardRoles,
): { readonly bodyRoles: CardRoles; readonly linkColumns: readonly ListColumnViewModel[] } {
  if (m.rowOpener(row) === undefined) return { bodyRoles: roles, linkColumns: [] };
  const lead = roles.lead;
  const leadColumn = lead !== undefined && needsControlOutsideOpener(row, lead) ? lead : undefined;
  const linkMeta = roles.meta.filter((col) => needsControlOutsideOpener(row, col));
  if (leadColumn === undefined && linkMeta.length === 0) {
    return { bodyRoles: roles, linkColumns: [] };
  }
  return {
    bodyRoles: {
      ...roles,
      lead: leadColumn === undefined ? lead : undefined,
      meta: roles.meta.filter((col) => !linkMeta.includes(col)),
    },
    linkColumns: [...(leadColumn !== undefined ? [leadColumn] : []), ...linkMeta],
  };
}

export function renderCardLinks(
  m: DataTableModel,
  row: ListRowViewModel,
  linkColumns: readonly ListColumnViewModel[],
): ReactNode {
  return (
    <div
      data-testid={`card-links-${row.id}`}
      className="flex flex-wrap items-center gap-x-3 text-[13px] leading-5"
    >
      {linkColumns.map((col) => (
        <span key={col.field} data-testid={cellTestIdOf(m, row, col.field)}>
          {cardCell(m, row, col, { linksAllowed: true })}
        </span>
      ))}
    </div>
  );
}

function renderMetaCell(
  m: DataTableModel,
  row: ListRowViewModel,
  col: ListColumnViewModel,
): ReactNode {
  return (
    <div
      key={col.field}
      data-testid={cellTestIdOf(m, row, col.field)}
      className="min-w-0 max-w-full truncate leading-5"
      onPointerEnter={showFullTextOnHover}
    >
      {isBadgeColumn(col) ? (
        <span className="inline-flex align-middle">{cardCell(m, row, col)}</span>
      ) : (
        cardCell(m, row, col)
      )}
    </div>
  );
}

function renderCardMeta(
  m: DataTableModel,
  row: ListRowViewModel,
  metaColumns: readonly ListColumnViewModel[],
): ReactNode {
  return (
    // One column per line, truncated on its own line.
    <div className="min-w-0">
      <div
        data-testid={`card-meta-${row.id}`}
        className="flex min-w-0 flex-col text-[13px] leading-5 tabular-nums text-foreground-secondary"
      >
        {cardMetaLines(metaColumns).map((line) =>
          line[0]?.narrowInline === true ? (
            <div
              key={line.map((col) => col.field).join("|")}
              data-testid={`card-vals-${row.id}-${line[0].field}`}
              className="mt-1 flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] leading-5"
            >
              {line.map((col) => renderMetaCell(m, row, col))}
            </div>
          ) : (
            <div
              key={line.map((col) => col.field).join("|")}
              className="flex h-5 min-w-0 max-w-full items-center"
            >
              {line.map((col) => renderMetaCell(m, row, col))}
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function renderCardLead(
  m: DataTableModel,
  row: ListRowViewModel,
  lead: ListColumnViewModel | undefined,
): ReactNode {
  if (lead === undefined || isEmptyCellValue(row.values[lead.field])) return null;
  return (
    <div
      data-testid={cellTestIdOf(m, row, lead.field)}
      className="min-w-0 text-xs font-medium leading-5"
    >
      {cardCell(m, row, lead)}
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
          className="min-w-0 truncate text-[14.5px] font-semibold text-foreground"
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
        {renderCardLead(m, row, roles.lead)}
        {renderCardHeading(m, row, roles)}
        {metaColumns.length > 0 && renderCardMeta(m, row, metaColumns)}
      </div>
      {m.rowOpener(row) !== undefined && (
        <ChevronRight className="size-4 shrink-0 text-border-strong" aria-hidden="true" />
      )}
    </>
  );
}

import { type cardColumnRoles, cardMetaLines } from "@cosmicdrift/kumiko-framework/ui-types";
import { Sparkles } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import type {
  ListColumnHintViewModel,
  ListColumnViewModel,
  ListRowViewModel,
} from "../../../headless/index.ts";
import { cn } from "../../lib/cn.ts";
import {
  CellPill,
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

function withoutPill(col: ListColumnViewModel): ListColumnViewModel {
  const { pillField: _pill, pillToneField: _pillTone, ...rest } = col;
  return rest;
}

function cardCell(
  m: DataTableModel,
  row: ListRowViewModel,
  col: ListColumnViewModel,
  { linksAllowed, omitPill }: { readonly linksAllowed: boolean; readonly omitPill?: boolean } = {
    linksAllowed: false,
  },
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
      {...columnCellPresentationProps(omitPill === true ? withoutPill(col) : col)}
      {...(col.hint !== undefined && { hint: cardHint(col.hint) })}
      {...(col.fileDisplay !== undefined && { fileDisplay: col.fileDisplay, compactFile: true })}
      {...(onCellChange !== undefined && {
        onChange: (value: unknown) => onCellChange(row.id, col.field, value),
      })}
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
      className="flex flex-wrap items-center gap-x-3 text-[13px] font-medium leading-5 text-primary"
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
      className={`min-w-0 max-w-full leading-5 ${col.ellipsis === true ? "truncate" : "break-words"}${col.multiline === true ? " whitespace-pre-line" : ""}${col.emphasis === true ? " font-semibold text-foreground" : ""}`}
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
  placement: "above" | "below" = "below",
): ReactNode {
  const plain = m.plainPhoneCards === true;
  const lines = cardMetaLines(metaColumns);
  return (
    // One column per line, truncated on its own line.
    <div className="min-w-0">
      <div
        data-testid={placement === "above" ? `card-above-${row.id}` : `card-meta-${row.id}`}
        className={`flex min-w-0 flex-col text-[12.5px] leading-5 tabular-nums text-muted-foreground`}
      >
        {lines.map((line, lineIndex) =>
          line[0]?.narrowInline === true ? (
            <div
              key={line.map((col) => col.field).join("|")}
              data-testid={`card-vals-${row.id}-${line[0].field}`}
              className={cn(
                "mt-1 flex min-w-0 max-w-full flex-wrap items-center gap-y-0.5 text-[12.5px] leading-5",
                plain ? "gap-x-0" : "gap-x-3",
              )}
            >
              {line.map((col, colIndex) => (
                <Fragment key={col.field}>
                  {plain && colIndex > 0 && <span aria-hidden="true">,&nbsp;</span>}
                  {renderMetaCell(m, row, col)}
                </Fragment>
              ))}
            </div>
          ) : (
            <div
              key={line.map((col) => col.field).join("|")}
              className={cn(
                "flex min-h-5 min-w-0 max-w-full items-center",
                plain &&
                  placement === "below" &&
                  lineIndex === lines.length - 1 &&
                  "text-foreground",
              )}
            >
              {line.map((col) => renderMetaCell(m, row, col))}
            </div>
          ),
        )}
      </div>
    </div>
  );
}

// Header line of the card: the "to do" sentence (primary with a sparkle when the column is `emphasis`)
// on the left, the column's extra pill on the right.
function renderCardLead(
  m: DataTableModel,
  row: ListRowViewModel,
  lead: ListColumnViewModel | undefined,
): ReactNode {
  if (lead === undefined || isEmptyCellValue(row.values[lead.field])) return null;
  const emphasized = lead.emphasis === true;
  const pill = (
    <CellPill row={row.values} pillField={lead.pillField} pillToneField={lead.pillToneField} />
  );
  return (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <div
        data-testid={cellTestIdOf(m, row, lead.field)}
        className={`flex min-w-0 items-start gap-1.5 text-xs leading-5 ${emphasized ? "font-medium text-primary [&_span]:text-primary" : "font-medium text-muted-foreground"}`}
      >
        {emphasized && <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />}
        {cardCell(m, row, lead, { linksAllowed: false, omitPill: true })}
      </div>
      {pill !== null && <span className="shrink-0">{pill}</span>}
    </div>
  );
}

const OUTLINED_NEUTRAL_PILL_CLASS =
  "[&_span]:border [&_span]:border-border-strong [&_span]:bg-transparent [&_span]:text-muted-foreground";

function renderCardStatus(
  m: DataTableModel,
  row: ListRowViewModel,
  status: ListColumnViewModel,
): ReactNode {
  const cell = cardCell(m, row, status);
  return (
    <span data-testid={cellTestIdOf(m, row, status.field)} className="shrink-0">
      {status.cardBadge === true ? (
        isBadgeColumn(status) ? (
          <span className={`inline-flex ${OUTLINED_NEUTRAL_PILL_CLASS}`}>{cell}</span>
        ) : (
          <span className="inline-flex rounded-full border border-border-strong px-2 py-0.5 text-xs text-muted-foreground">
            {cell}
          </span>
        )
      ) : (
        cell
      )}
    </span>
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
      {showStatus && renderCardStatus(m, row, cardStatusColumn)}
    </div>
  );
}

export function renderCardBody(
  m: DataTableModel,
  row: ListRowViewModel,
  roles: CardRoles,
): ReactNode {
  const { image: cardImageColumn, meta: cardMetaColumns } = roles;
  const shownMeta = cardMetaColumns.filter(
    (col) =>
      !isEmptyCellValue(row.values[col.field]) &&
      !isUnlabeledFalse(col.type, row.values[col.field], col.renderer),
  );
  const aboveColumns = shownMeta.filter((col) => col.cardAbove === true);
  const metaColumns = shownMeta.filter((col) => col.cardAbove !== true);
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
        {aboveColumns.length > 0 && renderCardMeta(m, row, aboveColumns, "above")}
        {renderCardHeading(m, row, roles)}
        {metaColumns.length > 0 && renderCardMeta(m, row, metaColumns)}
      </div>
    </>
  );
}

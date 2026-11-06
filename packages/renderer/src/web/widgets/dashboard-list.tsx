import type {
  DashboardListRowToneMarker,
  SelectOptionTone,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import {
  type CellLink,
  EMPTY_VALUE_PLACEHOLDER,
  type ListColumnHintViewModel,
  type RuntimeCellLink,
} from "../../headless/index.ts";
import { isSelectOptionTone } from "../../status-tone.ts";
import { cn } from "../lib/cn.ts";
import { HintCell } from "../primitives/data-table/hint-cell.tsx";
import {
  CellTextLink,
  LINK_BUTTON_CLASS,
  LIST_BADGE_TONE,
  rowToneClass,
  toneDotClass,
} from "../primitives/data-table-cell.tsx";
import { HintReasonRowScope, hintReasonOf } from "../primitives/hint-reason-row.tsx";
import { StatusBadge } from "./status-badge.tsx";

export type DashboardListColumn = {
  readonly field: string;
  /** Translated by the caller. */
  readonly label: string;
  readonly display?: "bar" | "badge" | "datetime" | "button";
  readonly badgeToneField?: string;
  readonly badgeDot?: false;
  /** `false` leaves an empty cell blank instead of drawing the placeholder. */
  readonly emptyPlaceholder?: false;
  /** Resolves the raw cell value to display text, e.g. a reference id to its label. */
  readonly renderValue?: (value: unknown, row: Readonly<Record<string, unknown>>) => string;
  /** Links the rendered text to its target, e.g. a reference cell to the record's detail. */
  readonly linkFor?: RuntimeCellLink;
  /** "To do" cell; owns the rendering, `toneField` already defaulted by the caller. */
  readonly hint?: ListColumnHintViewModel;
  /** `showOnNarrowOnly`: drawn in the phone cards only, never as a table column. */
  readonly narrowOnly?: true;
};

export type DashboardListRow = Readonly<Record<string, unknown>>;
type Row = DashboardListRow;

function fractionOf(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
}

// Rows may carry i18n keys (quota labels, failure reasons); translate falls back to the key itself.
const I18N_KEY_SHAPE = /^[a-z][\w-]*(?:[:.][\w-]+)+$/i;

function timestampMsOf(raw: unknown): number {
  return typeof raw === "number" ? raw : typeof raw === "string" ? Date.parse(raw) : Number.NaN;
}

/** Plain-text form of a cell value, for places that cannot render the cell itself (phone line). */
export function dashboardListCellText(
  column: Pick<DashboardListColumn, "display" | "renderValue">,
  row: Row,
  field: string,
  formats: {
    readonly formatPercent: (fraction: number) => string;
    readonly formatNumber: (value: number) => string;
    readonly formatDateTime: (atMs: number) => string;
  },
  translate: (key: string) => string,
): string | undefined {
  const raw = row[field];
  if (column.display === "bar") return formats.formatPercent(fractionOf(raw));
  if (column.display === "datetime") {
    const atMs = timestampMsOf(raw);
    return Number.isFinite(atMs) ? formats.formatDateTime(atMs) : undefined;
  }
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (column.renderValue === undefined && typeof raw === "number") return formats.formatNumber(raw);
  const text =
    column.renderValue !== undefined
      ? column.renderValue(raw, row)
      : typeof raw === "string"
        ? raw
        : undefined;
  if (text === undefined) return undefined;
  return I18N_KEY_SHAPE.test(text) ? translate(text) : text;
}

export function DashboardListCell({
  column,
  row,
  formatPercent,
  formatNumber,
  formatDateTime,
  translate,
  leading,
}: {
  /** Only a `hint` column takes it: it stands on the sentence's line, in front of it. */
  readonly leading?: ReactNode;
  readonly column: DashboardListColumn;
  readonly row: Row;
  readonly formatPercent: (fraction: number) => string;
  readonly formatNumber: (value: number) => string;
  readonly formatDateTime: (atMs: number) => string;
  readonly translate: (key: string) => string;
}): ReactNode {
  const raw = row[column.field];
  const empty = column.emptyPlaceholder === false ? "" : EMPTY_VALUE_PLACEHOLDER;
  if (column.hint !== undefined) {
    return <HintCell value={raw} row={row} hint={column.hint} leading={leading} />;
  }
  if (column.display === "bar") {
    const fraction = fractionOf(raw);
    return (
      <div className="flex items-center gap-2">
        <div
          role="progressbar"
          aria-valuenow={Math.round(fraction * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={column.label}
          className="h-1 min-w-16 flex-1 overflow-hidden rounded-full bg-border"
        >
          <div
            className="h-full rounded-full bg-status-active"
            style={{ width: `${fraction * 100}%` }}
          />
        </div>
        <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
          {formatPercent(fraction)}
        </span>
      </div>
    );
  }
  if (column.display === "badge") {
    if (raw === undefined || raw === null || raw === "") return empty;
    const toneKey = column.badgeToneField !== undefined ? row[column.badgeToneField] : undefined;
    const tone = (typeof toneKey === "string" ? LIST_BADGE_TONE[toneKey] : undefined) ?? "muted";
    return (
      <StatusBadge tone={tone} dot={column.badgeDot !== false}>
        {String(raw)}
      </StatusBadge>
    );
  }
  if (column.display === "datetime") {
    const atMs = timestampMsOf(raw);
    if (!Number.isFinite(atMs)) return empty;
    return <span className="font-mono text-[12.5px] tabular-nums">{formatDateTime(atMs)}</span>;
  }
  if (column.display === "button") {
    const link = column.linkFor?.(raw, row);
    if (raw === undefined || raw === null || raw === "") return empty;
    const text = column.renderValue?.(raw, row) ?? String(raw);
    const label = I18N_KEY_SHAPE.test(text) ? translate(text) : text;
    return link === undefined ? (
      label
    ) : (
      <CellTextLink link={link} className={LINK_BUTTON_CLASS}>
        {label}
      </CellTextLink>
    );
  }
  if (column.renderValue !== undefined) {
    const text = column.renderValue(raw, row);
    const link = column.linkFor?.(raw, row);
    return link === undefined ? text : <CellTextLink link={link}>{text}</CellTextLink>;
  }
  const link = column.linkFor?.(raw, row);
  if (typeof raw === "number") {
    const number = <span className="tabular-nums">{formatNumber(raw)}</span>;
    return link === undefined ? number : <CellTextLink link={link}>{number}</CellTextLink>;
  }
  if (raw === undefined || raw === null || raw === "") return empty;
  const text = String(raw);
  const shown = I18N_KEY_SHAPE.test(text) ? translate(text) : text;
  return link === undefined ? shown : <CellTextLink link={link}>{shown}</CellTextLink>;
}

export function rowToneOf(
  row: Row,
  rowToneField: string | undefined,
): SelectOptionTone | undefined {
  const value = rowToneField === undefined ? undefined : row[rowToneField];
  return isSelectOptionTone(value) ? value : undefined;
}

function RowLinkIcon({
  link,
  icon,
  label,
}: {
  readonly label: string;
  readonly link: CellLink | undefined;
  readonly icon: "arrow" | "chevron";
}): ReactNode {
  if (link === undefined) return null;
  const Glyph = icon === "chevron" ? ChevronRight : ArrowUpRight;
  return (
    <CellTextLink link={link} className="inline-flex text-muted-foreground hover:text-foreground">
      <Glyph className="size-4" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </CellTextLink>
  );
}

const INTERACTIVE_DESCENDANT_SELECTOR = "a, button";

function pressRowLink(event: MouseEvent<HTMLElement>, link: CellLink | undefined): void {
  if (link === undefined) return;
  if (event.target instanceof Element && event.target.closest(INTERACTIVE_DESCENDANT_SELECTOR)) {
    return;
  }
  link.onPress();
}

function ToneDot({ tone }: { readonly tone: SelectOptionTone }): ReactNode {
  return (
    <span
      aria-hidden="true"
      data-testid="dashboard-list-tone-dot"
      className={cn("inline-block size-2 shrink-0 rounded-full", toneDotClass(tone))}
    />
  );
}

// Badges in front of the "to do" column belong to its line: they sit inline before the sentence.
function leadingBadgeColumnsOf(
  columns: readonly DashboardListColumn[],
): readonly DashboardListColumn[] {
  const hintIndex = columns.findIndex((column) => column.hint !== undefined);
  return columns.slice(0, Math.max(hintIndex, 0)).filter((column) => column.display === "badge");
}

/** Compact table for dashboard lists with optional bar/badge columns. Badge columns in front of a
 *  `hint` column join the hint's first line; rows with a tone get 12px of padding above and below. */
export function DashboardListTable({
  columns: allColumns,
  rows,
  formatPercent,
  formatNumber,
  formatDateTime,
  translate,
  testId,
  rowToneField,
  rowToneMarker = "bar",
  showHeader = true,
  rowLink,
}: {
  readonly columns: readonly DashboardListColumn[];
  readonly rows: readonly Row[];
  readonly formatPercent: (fraction: number) => string;
  readonly formatNumber: (value: number) => string;
  readonly formatDateTime: (atMs: number) => string;
  readonly translate: (key: string) => string;
  readonly testId?: string;
  /** Row field holding a SelectOptionTone; tints the row. */
  readonly rowToneField?: string;
  /** "bar" (default): stripe at the row's left edge; "dot": small dot in front of the first cell. */
  readonly rowToneMarker?: DashboardListRowToneMarker;
  /** `false` drops the column header row. */
  readonly showHeader?: boolean;
  /** Row is a link: `linkFor` resolves the target per row, the icon sits in an extra last cell. */
  readonly rowLink?: {
    readonly linkFor: (row: Row) => CellLink | undefined;
    readonly icon: "arrow" | "chevron";
  };
}): ReactNode {
  const visibleColumns = allColumns.filter((column) => column.narrowOnly !== true);
  const leadingBadgeColumns = leadingBadgeColumnsOf(visibleColumns);
  const columns = visibleColumns.filter((column) => !leadingBadgeColumns.includes(column));
  const hintColumn = columns.find((column) => column.hint !== undefined);
  const padded = rowToneField !== undefined || leadingBadgeColumns.length > 0;
  const cellProps = { formatPercent, formatNumber, formatDateTime, translate };
  return (
    <div className="overflow-x-auto">
      <table data-testid={testId} className="w-full text-sm">
        {showHeader && (
          <thead>
            <tr className="h-9 border-b border-border-row text-left text-xs text-muted-foreground">
              {columns.map((column) => (
                <th
                  key={column.field}
                  scope="col"
                  className={cn("px-4 font-medium", column.display === "button" && "text-right")}
                >
                  {column.label}
                </th>
              ))}
              {rowLink !== undefined && <th scope="col" className="w-8" />}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, index) => {
            const rowTarget = rowLink?.linkFor(row);
            const tone = rowToneOf(row, rowToneField);
            const dot =
              rowToneMarker === "dot" && tone !== undefined ? <ToneDot tone={tone} /> : null;
            const leadingFor = (column: DashboardListColumn, columnIndex: number): ReactNode => {
              const badges = column === hintColumn ? leadingBadgeColumns : [];
              const front = columnIndex === 0 ? dot : null;
              if (front === null && badges.length === 0) return undefined;
              return (
                <>
                  {front}
                  {badges.map((badge) => (
                    <DashboardListCell key={badge.field} column={badge} row={row} {...cellProps} />
                  ))}
                </>
              );
            };
            const rowKey = typeof row["id"] === "string" ? row["id"] : index;
            const rowElement = (
              <tr
                key={rowKey}
                {...(rowTarget !== undefined && {
                  onClick: (event: MouseEvent<HTMLElement>) => pressRowLink(event, rowTarget),
                })}
                className={cn(
                  "h-10 border-b border-border-row last:border-b-0 [&:has(+[data-reason-row])]:border-b-0",
                  rowTarget !== undefined && "cursor-pointer",
                  padded && "sm:[&>td]:py-3",
                  // Without a header row nothing labels the columns, so narrow screens stack them.
                  !showHeader &&
                    "max-sm:grid max-sm:h-auto max-sm:grid-cols-1 max-sm:gap-1 max-sm:py-2",
                  rowToneMarker === "bar" && rowToneClass(tone),
                )}
              >
                {columns.map((column, columnIndex) => {
                  const leading = leadingFor(column, columnIndex);
                  const cell = (
                    <DashboardListCell
                      column={column}
                      row={row}
                      {...cellProps}
                      {...(column.hint !== undefined && { leading })}
                    />
                  );
                  return (
                    <td
                      key={column.field}
                      className={cn(
                        "px-4",
                        column.display === "button" && "text-right",
                        !showHeader && "max-sm:block",
                      )}
                    >
                      {column.hint === undefined && dot !== null && columnIndex === 0 ? (
                        <span className="flex items-center gap-2">
                          {dot}
                          {cell}
                        </span>
                      ) : (
                        cell
                      )}
                    </td>
                  );
                })}
                {rowLink !== undefined && (
                  <td className="w-8 px-2 text-right">
                    <RowLinkIcon
                      link={rowTarget}
                      icon={rowLink.icon}
                      label={translate("kumiko.dashboard.list.open-row")}
                    />
                  </td>
                )}
              </tr>
            );
            const reasonHint = columns.find(
              (column) => column.hint !== undefined && hintReasonOf(column.hint, row) !== undefined,
            )?.hint;
            return (
              <HintReasonRowScope
                key={rowKey}
                hint={reasonHint}
                row={row}
                renderBoxRow={(box) => (
                  <tr data-reason-row="true" className="border-b border-border-row last:border-b-0">
                    <td
                      colSpan={columns.length + (rowLink !== undefined ? 1 : 0)}
                      className="px-4 pb-3"
                    >
                      {box}
                    </td>
                  </tr>
                )}
              >
                {rowElement}
              </HintReasonRowScope>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

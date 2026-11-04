import type { SelectOptionTone } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import {
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
} from "../primitives/data-table-cell.tsx";
import { StatusBadge } from "./status-badge.tsx";

export type DashboardListColumn = {
  readonly field: string;
  /** Translated by the caller. */
  readonly label: string;
  readonly display?: "bar" | "badge" | "datetime" | "button";
  readonly badgeToneField?: string;
  /** Resolves the raw cell value to display text, e.g. a reference id to its label. */
  readonly renderValue?: (value: unknown, row: Readonly<Record<string, unknown>>) => string;
  /** Links the rendered text to its target, e.g. a reference cell to the record's detail. */
  readonly linkFor?: RuntimeCellLink;
  /** "To do" cell; owns the rendering, `toneField` already defaulted by the caller. */
  readonly hint?: ListColumnHintViewModel;
};

type Row = Readonly<Record<string, unknown>>;

function fractionOf(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
}

// Rows may carry i18n keys (quota labels, failure reasons); translate falls back to the key itself.
const I18N_KEY_SHAPE = /^[a-z][\w-]*(?:[:.][\w-]+)+$/i;

function Cell({
  column,
  row,
  formatPercent,
  formatNumber,
  formatDateTime,
  translate,
}: {
  readonly column: DashboardListColumn;
  readonly row: Row;
  readonly formatPercent: (fraction: number) => string;
  readonly formatNumber: (value: number) => string;
  readonly formatDateTime: (atMs: number) => string;
  readonly translate: (key: string) => string;
}): ReactNode {
  const raw = row[column.field];
  if (column.hint !== undefined) return <HintCell value={raw} row={row} hint={column.hint} />;
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
    if (raw === undefined || raw === null || raw === "") return EMPTY_VALUE_PLACEHOLDER;
    const toneKey = column.badgeToneField !== undefined ? row[column.badgeToneField] : undefined;
    const tone = (typeof toneKey === "string" ? LIST_BADGE_TONE[toneKey] : undefined) ?? "muted";
    return <StatusBadge tone={tone}>{String(raw)}</StatusBadge>;
  }
  if (column.display === "datetime") {
    const atMs =
      typeof raw === "number" ? raw : typeof raw === "string" ? Date.parse(raw) : Number.NaN;
    if (!Number.isFinite(atMs)) return EMPTY_VALUE_PLACEHOLDER;
    return <span className="tabular-nums">{formatDateTime(atMs)}</span>;
  }
  if (column.display === "button") {
    const link = column.linkFor?.(raw, row);
    if (raw === undefined || raw === null || raw === "") return EMPTY_VALUE_PLACEHOLDER;
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
  if (raw === undefined || raw === null || raw === "") return EMPTY_VALUE_PLACEHOLDER;
  const text = String(raw);
  const shown = I18N_KEY_SHAPE.test(text) ? translate(text) : text;
  return link === undefined ? shown : <CellTextLink link={link}>{shown}</CellTextLink>;
}

function rowToneOf(row: Row, rowToneField: string | undefined): SelectOptionTone | undefined {
  const value = rowToneField === undefined ? undefined : row[rowToneField];
  return isSelectOptionTone(value) ? value : undefined;
}

/** Compact 40px-row table for dashboard lists with optional bar/badge
 *  columns. */
export function DashboardListTable({
  columns,
  rows,
  formatPercent,
  formatNumber,
  formatDateTime,
  translate,
  testId,
  rowToneField,
  showHeader = true,
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
  /** `false` drops the column header row. */
  readonly showHeader?: boolean;
}): ReactNode {
  return (
    <div className="overflow-x-auto">
      <table data-testid={testId} className="w-full text-sm">
        {showHeader && (
          <thead className="max-sm:hidden">
            <tr className="h-9 border-b border-border-row text-left text-xs text-muted-foreground">
              {columns.map((column) => (
                <th key={column.field} scope="col" className="px-4 font-medium">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={typeof row["id"] === "string" ? row["id"] : index}
              className={cn(
                "h-10 border-b border-border-row last:border-b-0",
                "max-sm:grid max-sm:h-auto max-sm:grid-cols-1 max-sm:gap-1 max-sm:py-2",
                rowToneClass(rowToneOf(row, rowToneField)),
              )}
            >
              {columns.map((column) => (
                <td key={column.field} className="px-4 max-sm:block">
                  <Cell
                    column={column}
                    row={row}
                    formatPercent={formatPercent}
                    formatNumber={formatNumber}
                    formatDateTime={formatDateTime}
                    translate={translate}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

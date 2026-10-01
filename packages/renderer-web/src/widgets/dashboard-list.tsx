import type { ReactNode } from "react";
import { StatusBadge, type StatusBadgeTone } from "./status-badge.js";

export type DashboardListColumn = {
  readonly field: string;
  /** Translated by the caller. */
  readonly label: string;
  readonly display?: "bar" | "badge";
  readonly badgeToneField?: string;
};

const BADGE_TONE: Readonly<Record<string, StatusBadgeTone>> = {
  positive: "ok",
  warn: "warn",
  negative: "bad",
  neutral: "muted",
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
  translate,
}: {
  readonly column: DashboardListColumn;
  readonly row: Row;
  readonly formatPercent: (fraction: number) => string;
  readonly formatNumber: (value: number) => string;
  readonly translate: (key: string) => string;
}): ReactNode {
  const raw = row[column.field];
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
    if (raw === undefined || raw === null || raw === "") return "—";
    const toneKey = column.badgeToneField !== undefined ? row[column.badgeToneField] : undefined;
    const tone = (typeof toneKey === "string" ? BADGE_TONE[toneKey] : undefined) ?? "muted";
    return <StatusBadge tone={tone}>{String(raw)}</StatusBadge>;
  }
  if (typeof raw === "number") return <span className="tabular-nums">{formatNumber(raw)}</span>;
  if (raw === undefined || raw === null || raw === "") return "—";
  const text = String(raw);
  return I18N_KEY_SHAPE.test(text) ? translate(text) : text;
}

/** Kompakte 40px-Zeilen-Tabelle für Dashboard-Listen mit optionalen
 *  Balken-/Badge-Spalten. */
export function DashboardListTable({
  columns,
  rows,
  formatPercent,
  formatNumber,
  translate,
  testId,
}: {
  readonly columns: readonly DashboardListColumn[];
  readonly rows: readonly Row[];
  readonly formatPercent: (fraction: number) => string;
  readonly formatNumber: (value: number) => string;
  readonly translate: (key: string) => string;
  readonly testId?: string;
}): ReactNode {
  return (
    <div className="overflow-x-auto">
      <table data-testid={testId} className="w-full text-sm">
        <thead>
          <tr className="h-9 border-b border-border-row text-left text-xs text-muted-foreground">
            {columns.map((column) => (
              <th key={column.field} scope="col" className="px-4 font-medium">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={typeof row["id"] === "string" ? row["id"] : index}
              className="h-10 border-b border-border-row last:border-b-0"
            >
              {columns.map((column) => (
                <td key={column.field} className="px-4">
                  <Cell
                    column={column}
                    row={row}
                    formatPercent={formatPercent}
                    formatNumber={formatNumber}
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

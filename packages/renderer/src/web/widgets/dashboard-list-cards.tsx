import type { ReactNode } from "react";
import { isSelectOptionTone } from "../../status-tone.ts";
import { cn } from "../lib/cn.ts";
import {
  DIMMED_HINT_SENTENCE_CLASS,
  HINT_TONE_TEXT_CLASS,
  isDimmedHintSentence,
} from "../primitives/data-table/hint-cell.tsx";
import { cardToneClass } from "../primitives/data-table-cell.tsx";
import {
  DashboardListCell,
  type DashboardListColumn,
  type DashboardListRow,
  rowToneOf,
} from "./dashboard-list.tsx";

type CardsProps = {
  readonly columns: readonly DashboardListColumn[];
  readonly rows: readonly DashboardListRow[];
  readonly formatPercent: (fraction: number) => string;
  readonly formatNumber: (value: number) => string;
  readonly formatDateTime: (atMs: number) => string;
  readonly translate: (key: string) => string;
  readonly testId?: string;
  readonly rowToneField?: string;
  /** Row field replacing the hint sentence as card title. */
  readonly titleField?: string;
};

type HintColumn = DashboardListColumn & { readonly hint: NonNullable<DashboardListColumn["hint"]> };

function nonEmptyText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

// The reason toggle of the table is left out on purpose: a phone card shows its facts, not a hidden explanation.
function CardHeadline({
  column,
  row,
  titleField,
}: {
  readonly column: HintColumn;
  readonly row: DashboardListRow;
  readonly titleField: string | undefined;
}): ReactNode {
  const { hint } = column;
  const sentence =
    (titleField === undefined ? undefined : nonEmptyText(row[titleField])) ??
    nonEmptyText(row[column.field]);
  const toneValue = hint.toneField === undefined ? undefined : row[hint.toneField];
  const tone = isSelectOptionTone(toneValue) ? toneValue : undefined;
  if (sentence === undefined) {
    return (
      <span data-hint-empty="true" className="text-sm text-muted-foreground">
        {hint.emptyLabel}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "text-sm",
        isDimmedHintSentence(tone, hint.plainSentence)
          ? DIMMED_HINT_SENTENCE_CLASS
          : [
              "font-semibold",
              hint.plainSentence !== true && tone !== undefined && HINT_TONE_TEXT_CLASS[tone],
            ],
      )}
    >
      {sentence}
    </span>
  );
}

function detailOf(hint: HintColumn["hint"] | undefined, row: DashboardListRow): string | undefined {
  if (hint === undefined) return undefined;
  const field = hint.narrowDetailField ?? hint.detailField;
  return field === undefined ? undefined : nonEmptyText(row[field]);
}

/** One card per row for the phone layout of a dashboard list. Row 1: badges and a one-line detail, row 2: the hint sentence, row 3: `showOnNarrowOnly` columns left and the small buttons right. */
export function DashboardListCards({
  columns,
  rows,
  testId,
  rowToneField,
  titleField,
  ...cellProps
}: CardsProps): ReactNode {
  const hintColumn = columns.find((column): column is HintColumn => column.hint !== undefined);
  const plain = columns.filter((column) => column.hint === undefined);
  const badgeColumns = plain.filter((column) => column.display === "badge");
  const buttonColumns = plain.filter((column) => column.display === "button");
  const otherColumns = plain.filter(
    (column) => column.display !== "badge" && column.display !== "button",
  );
  const cell = (column: DashboardListColumn, row: DashboardListRow): ReactNode => (
    <DashboardListCell key={column.field} column={column} row={row} {...cellProps} />
  );
  return (
    <ul data-testid={testId} className="m-0 flex list-none flex-col gap-2 p-0">
      {rows.map((row, index) => {
        const detail = detailOf(hintColumn?.hint, row);
        const badges = badgeColumns.filter((column) => hasValue(row[column.field]));
        const buttons = buttonColumns.filter((column) => hasValue(row[column.field]));
        const others = otherColumns.filter((column) => hasValue(row[column.field]));
        return (
          <li
            key={typeof row["id"] === "string" ? row["id"] : index}
            data-testid="dashboard-list-card"
            className={cn(
              "flex flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2.5",
              cardToneClass(
                rowToneField === undefined
                  ? undefined
                  : (rowToneOf(row, rowToneField) ?? "neutral"),
              ),
            )}
          >
            {(badges.length > 0 || detail !== undefined) && (
              <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                {badges.map((column) => cell(column, row))}
                {detail !== undefined && (
                  <small
                    data-testid="dashboard-list-card-detail"
                    className="min-w-0 truncate text-xs"
                  >
                    {detail}
                  </small>
                )}
              </div>
            )}
            {hintColumn !== undefined && (
              <CardHeadline column={hintColumn} row={row} titleField={titleField} />
            )}
            {(others.length > 0 || buttons.length > 0) && (
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col text-xs text-muted-foreground">
                  {others.map((column) => (
                    <span key={column.field} className="truncate">
                      {cell(column, row)}
                    </span>
                  ))}
                </div>
                {buttons.length > 0 && (
                  <div className="flex shrink-0 flex-wrap justify-end gap-2 [&_a]:relative [&_a]:h-8 [&_a]:px-2.5 [&_a]:text-xs [&_a]:max-md:min-h-0 [&_a]:before:absolute [&_a]:before:inset-x-0 [&_a]:before:-inset-y-1.5 [&_a]:before:content-['']">
                    {buttons.map((column) => cell(column, row))}
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

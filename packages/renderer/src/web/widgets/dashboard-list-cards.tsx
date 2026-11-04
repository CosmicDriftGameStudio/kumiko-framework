import { Fragment, type ReactNode, useState } from "react";
import { isSelectOptionTone } from "../../status-tone.ts";
import { cn } from "../lib/cn.ts";
import { HINT_TONE_TEXT_CLASS } from "../primitives/data-table/hint-cell.tsx";
import { cardToneClass } from "../primitives/data-table-cell.tsx";
import { ReasonBox, ReasonInfoButton } from "../primitives/reason-box.tsx";
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
};

function nonEmptyText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function CardHeadline({
  column,
  row,
}: {
  readonly column: DashboardListColumn & {
    readonly hint: NonNullable<DashboardListColumn["hint"]>;
  };
  readonly row: DashboardListRow;
}): ReactNode {
  const [reasonOpen, setReasonOpen] = useState(false);
  const { hint } = column;
  const sentence = nonEmptyText(row[column.field]);
  const toneValue = hint.toneField === undefined ? undefined : row[hint.toneField];
  const tone = isSelectOptionTone(toneValue) ? toneValue : undefined;
  const reason = hint.reasonField === undefined ? undefined : nonEmptyText(row[hint.reasonField]);
  if (sentence === undefined) {
    return (
      <span data-hint-empty="true" className="text-sm text-muted-foreground">
        {hint.emptyLabel}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span className="flex items-start gap-2">
        <span
          className={cn(
            "text-sm font-semibold",
            hint.plainSentence !== true && tone !== undefined && HINT_TONE_TEXT_CLASS[tone],
          )}
        >
          {sentence}
        </span>
        {reason !== undefined && (
          <ReasonInfoButton
            label={hint.reasonLabel}
            open={reasonOpen}
            onToggle={() => setReasonOpen((open) => !open)}
            data-hint-reason-toggle="true"
          />
        )}
      </span>
      {reason !== undefined && reasonOpen && (
        <ReasonBox data-hint-reason="true">{reason}</ReasonBox>
      )}
    </span>
  );
}

/** One card per row for the phone layout of a dashboard list: badge and detail on top, the hint sentence, other columns, buttons at the bottom right. */
export function DashboardListCards({
  columns,
  rows,
  testId,
  rowToneField,
  ...cellProps
}: CardsProps): ReactNode {
  const hintColumn = columns.find(
    (
      column,
    ): column is DashboardListColumn & {
      readonly hint: NonNullable<DashboardListColumn["hint"]>;
    } => column.hint !== undefined,
  );
  const badgeColumns = columns.filter(
    (column) => column.hint === undefined && column.display === "badge",
  );
  const buttonColumns = columns.filter(
    (column) => column.hint === undefined && column.display === "button",
  );
  const otherColumns = columns.filter(
    (column) =>
      column.hint === undefined && column.display !== "badge" && column.display !== "button",
  );
  const cell = (column: DashboardListColumn, row: DashboardListRow): ReactNode => (
    <DashboardListCell key={column.field} column={column} row={row} {...cellProps} />
  );
  return (
    <ul data-testid={testId} className="m-0 flex list-none flex-col gap-2 p-0">
      {rows.map((row, index) => {
        const detail =
          hintColumn?.hint.detailField === undefined
            ? undefined
            : nonEmptyText(row[hintColumn.hint.detailField]);
        const badges = badgeColumns.filter((column) => hasValue(row[column.field]));
        const buttons = buttonColumns.filter((column) => hasValue(row[column.field]));
        const others = otherColumns.filter((column) => hasValue(row[column.field]));
        return (
          <li
            key={typeof row["id"] === "string" ? row["id"] : index}
            data-testid="dashboard-list-card"
            className={cn(
              "flex flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2.5",
              cardToneClass(rowToneOf(row, rowToneField)),
            )}
          >
            {(badges.length > 0 || detail !== undefined) && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                {badges.map((column) => cell(column, row))}
                {detail !== undefined && <small className="text-xs">{detail}</small>}
              </div>
            )}
            {hintColumn !== undefined && <CardHeadline column={hintColumn} row={row} />}
            {(others.length > 0 || buttons.length > 0) && (
              <div className="flex items-end justify-between gap-3">
                <div className="min-w-0 text-xs text-muted-foreground">
                  {others.map((column, position) => (
                    <Fragment key={column.field}>
                      {position > 0 && " · "}
                      {cell(column, row)}
                    </Fragment>
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

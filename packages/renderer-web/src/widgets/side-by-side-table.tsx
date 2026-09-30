import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export type SideBySideTableColumn = {
  readonly id: string;
  readonly label: string;
};

export type SideBySideTableCell = {
  readonly content: ReactNode;
  /** Spans this cell over following columns (a value that is identical on
   *  both sides shown once). */
  readonly colSpan?: number;
};

export type SideBySideTableRow = {
  readonly id: string;
  readonly header: ReactNode;
  readonly cells: readonly SideBySideTableCell[];
  /** Highlights a row that needs attention (e.g. differing values). */
  readonly tone?: "warn";
};

/** Small read-only grid with real table semantics (`th scope`) whose cells
 *  are arbitrary React nodes — for side-by-side comparisons like "from the
 *  document" vs. "in stock". Not a `DataTable`: no sorting, paging, or
 *  view-model columns. */
export function SideBySideTable({
  caption,
  rowHeaderLabel,
  columns,
  rows,
  rowHeaderWidth = 120,
  testId,
}: {
  /** Accessible name of the table, not rendered visibly. */
  readonly caption: string;
  readonly rowHeaderLabel: string;
  readonly columns: readonly SideBySideTableColumn[];
  readonly rows: readonly SideBySideTableRow[];
  readonly rowHeaderWidth?: number;
  readonly testId?: string;
}): ReactNode {
  return (
    <table
      data-testid={testId}
      className="w-full table-fixed border-collapse border border-border text-sm"
    >
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="bg-muted text-[13px] text-muted-foreground">
          <th
            scope="col"
            style={{ width: rowHeaderWidth }}
            className="border-b border-border px-3 py-2 text-left font-medium"
          >
            {rowHeaderLabel}
          </th>
          {columns.map((column) => (
            <th
              key={column.id}
              scope="col"
              className="border-b border-border px-3 py-2 text-left font-medium"
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className={cn(row.tone === "warn" && "bg-status-warn-surface")}>
            <th
              scope="row"
              className={cn(
                "border-b border-border-row px-3 py-2 text-left align-top",
                row.tone === "warn"
                  ? "font-semibold text-status-warn"
                  : "font-normal text-muted-foreground",
              )}
            >
              {row.header}
            </th>
            {row.cells.map((cell, index) => (
              <td
                // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional against the column order and have no identity of their own
                key={index}
                colSpan={cell.colSpan}
                className="border-b border-border-row px-3 py-2 align-top"
              >
                {cell.content}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

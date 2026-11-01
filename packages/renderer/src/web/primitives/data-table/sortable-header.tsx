import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { DataTableSort, DataTableSortDir } from "../../../index.ts";
import { cn } from "../../lib/cn.ts";
import { TableHead } from "../../ui/table.tsx";
import { FIT_CONTENT_CELL_CLASS } from "../data-table-cell.tsx";

export const COMPACT_HEADER_CLASS = "text-xs font-semibold";

// SortableHeader: renders the th header per column, with or without
// click-sort. Three paths:
//   (a) sortable=false OR no onSortChange -> plain label, no cursor
//       interaction (DataTable purely as a view without sort wiring).
//   (b) sortable=true + onSortChange -> header is a button, click
//       cycles asc -> desc -> null. aria-sort mirrors the state.
//   (c) sortable=true in the schema but no onSortChange prop -> still
//       label-only, but data-sortable=true stays so tests that know the
//       schema view keep working.
export function SortableHeader({
  field,
  label,
  sortable,
  highlighted,
  numeric,
  fitContent,
  compact,
  className,
  sort,
  onSortChange,
  style,
  columnField,
  trailing,
}: {
  readonly field: string;
  readonly label: string;
  readonly sortable: boolean;
  readonly highlighted?: boolean;
  readonly numeric?: boolean;
  readonly fitContent?: boolean;
  readonly compact?: boolean;
  readonly className?: string;
  readonly sort?: DataTableSort;
  readonly onSortChange?: (next: DataTableSort | null) => void;
  readonly style?: CSSProperties;
  readonly columnField?: string;
  /** Rendered inside the th after the label, e.g. a resize handle. */
  readonly trailing?: ReactNode;
}): ReactNode {
  const active = sort?.field === field ? sort : undefined;
  const ariaSort: "ascending" | "descending" | "none" =
    active?.dir === "asc" ? "ascending" : active?.dir === "desc" ? "descending" : "none";

  const cellExtras = {
    ...(style !== undefined && { style }),
    ...(columnField !== undefined && { "data-column-field": columnField }),
  };

  if (!sortable || onSortChange === undefined) {
    return (
      <TableHead
        data-testid={`column-${field}`}
        data-sortable={sortable === true ? true : undefined}
        data-highlighted={highlighted === true ? "true" : undefined}
        className={cn(
          "font-medium whitespace-normal text-muted-foreground",
          numeric === true && "text-right",
          fitContent === true && FIT_CONTENT_CELL_CLASS,
          highlighted === true && "bg-accent/40",
          trailing !== undefined && "group/header relative",
          compact === true && COMPACT_HEADER_CLASS,
          className,
        )}
        {...cellExtras}
      >
        {label}
        {trailing}
      </TableHead>
    );
  }

  const Icon = active?.dir === "asc" ? ArrowUp : active?.dir === "desc" ? ArrowDown : ArrowUpDown;
  const next = nextSortState(active?.dir, field);

  return (
    <TableHead
      data-testid={`column-${field}`}
      data-sortable="true"
      data-highlighted={highlighted === true ? "true" : undefined}
      aria-sort={ariaSort}
      className={cn(
        active !== undefined
          ? "font-semibold text-foreground"
          : "font-medium text-muted-foreground",
        "whitespace-normal",
        numeric === true && "text-right",
        fitContent === true && FIT_CONTENT_CELL_CLASS,
        highlighted === true && "bg-accent/40",
        trailing !== undefined && "group/header relative",
        compact === true && COMPACT_HEADER_CLASS,
        className,
      )}
      {...cellExtras}
    >
      <button
        type="button"
        onClick={() => onSortChange(next)}
        className={cn(
          "group/sort inline-flex h-8 items-center gap-1.5 rounded-sm px-2 -mx-2 text-sm [font-weight:inherit]",
          "hover:bg-accent hover:text-accent-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          active !== undefined && "text-foreground",
          compact === true && "text-xs",
        )}
      >
        <span>{label}</span>
        <Icon
          data-sort-icon={active === undefined ? "idle" : "active"}
          className={cn(
            "size-3.5",
            active === undefined &&
              "opacity-0 group-hover/sort:opacity-40 group-focus-visible/sort:opacity-40",
          )}
          aria-hidden="true"
        />
      </button>
      {trailing}
    </TableHead>
  );
}

// 3-state toggle: no sort -> asc -> desc -> no sort. Idiomatic for
// power-user lists where "I want the server default order back" is a
// real action (instead of toggling asc<->desc forever).
function nextSortState(current: DataTableSortDir | undefined, field: string): DataTableSort | null {
  if (current === undefined) return { field, dir: "asc" };
  if (current === "asc") return { field, dir: "desc" };
  return null;
}

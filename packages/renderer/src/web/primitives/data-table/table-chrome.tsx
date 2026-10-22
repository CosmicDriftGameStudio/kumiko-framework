import { ChevronRight } from "lucide-react";
import type { ReactNode, TableHTMLAttributes } from "react";
import { cn } from "../../lib/cn.ts";
import { Button as UiButton } from "../../ui/button.tsx";

// The vendored Table wraps <table> in an `overflow-x-auto` container, which
// would become the scrollport of a sticky header. A scrollBody table scrolls
// in its parent instead, so it renders the bare <table>.
export function FlushTable({
  className,
  ...props
}: TableHTMLAttributes<HTMLTableElement>): ReactNode {
  return (
    <table
      data-slot="table"
      className={cn("w-full caption-bottom text-sm", className)}
      {...props}
    />
  );
}

// Header cells stick to the scroll surface; the bottom rule is an inset
// shadow because a border on a sticky cell scrolls away under border-collapse.
// Column weight (medium vs. semibold for the sorted one) lives on the th itself
// in SortableHeader: a `[&_th]:font-*` rule here would outrank it.
// Child selectors only: an expanded row nests a whole table inside a cell, and
// descendant selectors would make its header sticky and re-pad its cells.
export const FILL_TABLE_CLASS = cn(
  "[&>thead>tr>th]:sticky [&>thead>tr>th]:top-0 [&>thead>tr>th]:z-10 [&>thead>tr>th]:h-9 [&>thead>tr>th]:bg-muted [&>thead>tr>th]:px-2 [&>thead>tr>th]:text-[13px]",
  "[&>thead>tr>th]:shadow-[inset_0_-1px_0_var(--color-border)] [&>thead>tr>th_button]:text-[13px] [&>tbody>tr>td]:px-2 [&>tbody>tr>td]:py-0",
  "[&>*>tr>:first-child]:pl-6 [&>*>tr>:last-child]:pr-6",
);

// `!`: beats the first/last-child padding of FILL_TABLE_CLASS, which would
// otherwise widen the narrow toggle column / pad the full-width expansion cell.
// The nested table's sticky actions cell (last td) gets the muted surface
// instead of its own md:bg-background, so it blends into the area.
export const EXPAND_TOGGLE_CELL_CLASS = "w-10 px-1! py-0!";

export const EXPANSION_CELL_CLASS =
  "whitespace-normal bg-muted p-0! align-top md:[&_td:last-child]:bg-muted";

export const EXPANSION_CONTENT_CLASS = "pt-1 pr-4 pb-3.5 pl-[52px]";

export function RowExpandToggle({
  expanded,
  controlsId,
  label,
  onToggle,
  testId,
}: {
  readonly expanded: boolean;
  readonly controlsId: string;
  readonly label: string;
  readonly onToggle: () => void;
  readonly testId: string;
}): ReactNode {
  return (
    <UiButton
      type="button"
      variant="ghost"
      size="icon"
      className="size-8 shrink-0 max-md:size-11"
      aria-expanded={expanded}
      {...(expanded && { "aria-controls": controlsId })}
      aria-label={label}
      data-testid={testId}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <ChevronRight
        className={cn("size-4 transition-transform", expanded && "rotate-90")}
        aria-hidden="true"
      />
    </UiButton>
  );
}

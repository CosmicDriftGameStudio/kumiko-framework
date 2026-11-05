import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import type { DataTableProps, DataTableSort } from "../../../index.ts";
import { useOptionalTranslation } from "../../../index.ts";
import { cn } from "../../lib/cn.ts";
import type { DataTableModel } from "./use-data-table-state.ts";

type SortOptions = NonNullable<DataTableProps["sortOptions"]>;

export function sortOptionValue(option: DataTableSort): string {
  return `${option.field}:${option.dir}`;
}

export function activeSortOption(
  options: SortOptions,
  sort: DataTableSort | null | undefined,
): SortOptions[number] | undefined {
  if (sort === undefined || sort === null) return undefined;
  return options.find((option) => option.field === sort.field && option.dir === sort.dir);
}

export function hasSortOptionsSelect(
  options: DataTableProps["sortOptions"],
  onSortChange: DataTableProps["onSortChange"],
): options is SortOptions {
  return onSortChange !== undefined && options !== undefined && options.length > 0;
}

// "Sorted by Urgency ↓ · 26 contracts": one sentence with the order and the size of the list.
// Undefined while no sort option is active, so the plain label stays.
export function sortSummaryText(m: DataTableModel): string | undefined {
  if (m.sortOptions === undefined) return undefined;
  const active = activeSortOption(m.sortOptions, m.sort);
  if (active === undefined) return undefined;
  const total = m.pager?.total ?? m.rows.length;
  const noun = m.itemNoun?.(total) ?? "";
  const direction = active.dir === "asc" ? "↑" : "↓";
  const count = total.toLocaleString();
  return (
    m.tableTranslate?.("kumiko.list.sort.summary", {
      sort: active.label,
      direction,
      count,
      noun,
    }) ?? `Sorted by ${active.label} ${direction} · ${count} ${noun}`
  ).trim();
}

// "Sorted by: <active label>" over a native select; with no matching option only the prefix shows
// so the control never claims an order the list is not in.
export function SortOptionsSelect({
  options,
  sort,
  onSortChange,
  testId,
  className,
  summary,
  bordered = false,
  chevron = true,
}: {
  readonly options: SortOptions;
  readonly sort: DataTableSort | null | undefined;
  readonly onSortChange: (next: DataTableSort | null) => void;
  readonly testId: string;
  readonly className?: string;
  /** Replaces the label text, e.g. with the sentence that also names the list size. */
  readonly summary?: string;
  /** Draws the select like the filter-row selects: bordered, same height. */
  readonly bordered?: boolean;
  /** `false` leaves the trailing chevron out, so a summary sentence reads as plain text. */
  readonly chevron?: boolean;
}): ReactNode {
  const translate = useOptionalTranslation();
  const active = activeSortOption(options, sort);
  const prefix = translate?.("kumiko.list.sort.prefix") ?? "Sorted by";
  return (
    <div
      className={cn(
        "relative flex h-9 items-center gap-1.5 rounded-md text-[13px] text-foreground-secondary focus-within:ring-1 focus-within:ring-ring",
        bordered && "rounded-md border border-border-strong bg-background px-2.5 text-foreground",
        className,
      )}
    >
      <span aria-hidden="true" data-testid={`${testId}-label`}>
        {summary ?? (active !== undefined ? `${prefix}: ${active.label}` : prefix)}
      </span>
      {chevron && <ChevronDown className="size-3.5" aria-hidden="true" />}
      <select
        aria-label={prefix}
        data-testid={testId}
        value={active !== undefined ? sortOptionValue(active) : ""}
        onChange={(e) => {
          const picked = options.find((option) => sortOptionValue(option) === e.target.value);
          if (picked !== undefined) onSortChange({ field: picked.field, dir: picked.dir });
        }}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      >
        {active === undefined && <option value="">{prefix}</option>}
        {options.map((option) => (
          <option key={sortOptionValue(option)} value={sortOptionValue(option)}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

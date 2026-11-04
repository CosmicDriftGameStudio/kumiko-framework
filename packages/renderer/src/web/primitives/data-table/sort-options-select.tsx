import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import type { DataTableProps, DataTableSort } from "../../../index.ts";
import { useOptionalTranslation } from "../../../index.ts";

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

// "Sorted by: <active label>" over a native select; with no matching option only the prefix shows
// so the control never claims an order the list is not in.
export function SortOptionsSelect({
  options,
  sort,
  onSortChange,
  testId,
  className,
}: {
  readonly options: SortOptions;
  readonly sort: DataTableSort | null | undefined;
  readonly onSortChange: (next: DataTableSort | null) => void;
  readonly testId: string;
  readonly className?: string;
}): ReactNode {
  const translate = useOptionalTranslation();
  const active = activeSortOption(options, sort);
  const prefix = translate?.("kumiko.list.sort.prefix") ?? "Sorted by";
  return (
    <div
      className={`relative flex h-9 items-center gap-1.5 text-[13px] text-foreground-secondary ${className ?? ""}`}
    >
      <span aria-hidden="true" data-testid={`${testId}-label`}>
        {active !== undefined ? `${prefix}: ${active.label}` : prefix}
      </span>
      <ChevronDown className="size-3.5" aria-hidden="true" />
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

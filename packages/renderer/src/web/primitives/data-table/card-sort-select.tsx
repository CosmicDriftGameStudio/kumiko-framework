import { ArrowDown, ArrowUp } from "lucide-react";
import type { ReactNode } from "react";
import type { DataTableSort, DataTableSortDir } from "../../../index.ts";
import { useOptionalTranslation } from "../../../index.ts";

type SortableColumn = {
  readonly field: string;
  readonly label: string;
  readonly sortable?: boolean;
};

type SortOption = {
  readonly value: string;
  readonly field: string;
  readonly dir: DataTableSortDir;
  readonly label: string;
};

// No column headers below the breakpoint, so the click-to-sort affordance
// on SortableHeader has nothing to attach to. A single native <select> is
// the whole fix — no custom widget, no menu — fed straight from the
// columns marked sortable in the ViewModel. Options carry the resolved
// {field, dir} directly so onChange can look the pick up by value instead
// of parsing/casting the option string back apart.
export function CardSortSelect({
  columns,
  sort,
  onSortChange,
  testId,
}: {
  readonly columns: readonly SortableColumn[];
  readonly sort: DataTableSort | null | undefined;
  readonly onSortChange: ((next: DataTableSort | null) => void) | undefined;
  readonly testId: string | undefined;
}): ReactNode {
  const translate = useOptionalTranslation();
  const sortableColumns = columns.filter((col) => col.sortable);
  if (onSortChange === undefined || sortableColumns.length === 0) return null;

  const sortOptions: readonly SortOption[] = sortableColumns.flatMap((col) => [
    { value: `${col.field}:asc`, field: col.field, dir: "asc", label: `${col.label} ↑` },
    { value: `${col.field}:desc`, field: col.field, dir: "desc", label: `${col.label} ↓` },
  ]);
  const sortLabel =
    sort !== undefined && sort !== null
      ? (translate?.("kumiko.list.sort.by", {
          column: columns.find((col) => col.field === sort.field)?.label ?? sort.field,
        }) ?? `Sorted by ${sort.field}`)
      : (translate?.("kumiko.list.sort.unsorted") ?? "Unsorted");
  const SortArrow = sort?.dir === "desc" ? ArrowDown : ArrowUp;
  // URL state can carry a sort on a column that is not sortable; without an
  // option for it the select would claim "Unsorted" while the list is sorted.
  const currentSortValue = sort !== undefined && sort !== null ? `${sort.field}:${sort.dir}` : "";
  const currentSortIsUnlisted =
    sort !== undefined && sort !== null && !sortOptions.some((o) => o.value === currentSortValue);
  return (
    <div className="relative flex h-9 items-center gap-1.5 px-4 text-[13px] text-foreground-secondary">
      <span aria-hidden="true">{sortLabel}</span>
      {sort !== undefined && sort !== null && <SortArrow className="size-3.5" aria-hidden="true" />}
      <select
        aria-label={translate?.("kumiko.list.sort.label") ?? "Sort"}
        data-testid={testId !== undefined ? `${testId}-sort` : "render-list-sort"}
        value={currentSortValue}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            onSortChange(null);
            return;
          }
          const picked = sortOptions.find((o) => o.value === raw);
          if (picked === undefined) return;
          onSortChange({ field: picked.field, dir: picked.dir });
        }}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      >
        <option value="">{translate?.("kumiko.list.sort.unsorted") ?? "Unsorted"}</option>
        {currentSortIsUnlisted && (
          <option value={currentSortValue}>
            {`${columns.find((col) => col.field === sort.field)?.label ?? sort.field} ${sort.dir === "desc" ? "↓" : "↑"}`}
          </option>
        )}
        {sortOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

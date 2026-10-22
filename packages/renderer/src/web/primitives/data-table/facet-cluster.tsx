import { X } from "lucide-react";
import type { ReactNode } from "react";
import type { DataTableListNotice } from "../../../data-table-aggregate-types.ts";
import { type DataTableProps, useOptionalTranslation } from "../../../index.ts";
import { Button as UiButton } from "../../ui/button.tsx";
import { DateRangeFacetFilter, FacetFilter } from "../facet-filter.tsx";
import { NumberRangeFacetFilter } from "../number-range-facet.tsx";
import { ResetAllButton } from "./reset-all-button.tsx";

type FacetClusterProps = Pick<
  DataTableProps,
  | "filterFacets"
  | "filterValues"
  | "onFilterChange"
  | "onFilterReset"
  | "dateRangeFacets"
  | "onDateRangeChange"
  | "rangeFacets"
  | "onRangeChange"
  | "resetAll"
  | "notice"
> & { readonly dense: boolean };

function ListNotice({ notice }: { readonly notice: DataTableListNotice }): ReactNode {
  const translate = useOptionalTranslation();
  const fallback =
    notice === "truncated"
      ? "Not every group is shown. Please narrow the list with a filter."
      : "The search matched too many entries; groups and totals cover only part of them. Please filter further.";
  return (
    <p
      role="status"
      data-testid="list-notice"
      data-notice={notice}
      className="m-0 basis-full text-xs text-muted-foreground"
    >
      {translate?.(`kumiko.list.notice.${notice}`) ?? fallback}
    </p>
  );
}

function FacetResetButton({ onReset }: { readonly onReset: () => void }): ReactNode {
  const translate = useOptionalTranslation();
  return (
    <UiButton
      variant="ghost"
      size="sm"
      className="h-9 px-2"
      onClick={onReset}
      data-testid="facet-reset"
    >
      {translate?.("kumiko.list.filter.reset") ?? "Reset"}
      <X />
    </UiButton>
  );
}

/** The toolbar's filter controls; undefined when the list has none. */
export function buildFacetCluster({
  filterFacets,
  filterValues,
  onFilterChange,
  onFilterReset,
  dateRangeFacets,
  onDateRangeChange,
  rangeFacets,
  onRangeChange,
  resetAll,
  notice,
  dense,
}: FacetClusterProps): ReactNode | undefined {
  const hasFacets =
    filterFacets !== undefined && filterFacets.length > 0 && onFilterChange !== undefined;
  const hasDateRangeFacets =
    dateRangeFacets !== undefined && dateRangeFacets.length > 0 && onDateRangeChange !== undefined;
  const hasRangeFacets =
    rangeFacets !== undefined && rangeFacets.length > 0 && onRangeChange !== undefined;
  const hasActiveFilters =
    filterValues !== undefined && Object.values(filterValues).some((v) => v.length > 0);
  const showsResetAll = resetAll?.active === true;
  if (
    !hasFacets &&
    !hasDateRangeFacets &&
    !hasRangeFacets &&
    !showsResetAll &&
    notice === undefined
  ) {
    return undefined;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {hasFacets &&
        filterFacets.map((facet) => (
          <FacetFilter
            key={facet.field}
            facet={facet}
            selected={filterValues?.[facet.field] ?? []}
            onChange={onFilterChange}
            dense={dense}
          />
        ))}
      {hasDateRangeFacets &&
        dateRangeFacets.map((facet) => (
          <DateRangeFacetFilter key={facet.field} facet={facet} onChange={onDateRangeChange} />
        ))}
      {hasRangeFacets &&
        rangeFacets.map((facet) => (
          <NumberRangeFacetFilter key={facet.field} facet={facet} onChange={onRangeChange} />
        ))}
      {resetAll === undefined && hasActiveFilters && onFilterReset !== undefined && (
        <FacetResetButton onReset={onFilterReset} />
      )}
      {showsResetAll && <ResetAllButton onReset={resetAll.onReset} />}
      {notice !== undefined && <ListNotice notice={notice} />}
    </div>
  );
}

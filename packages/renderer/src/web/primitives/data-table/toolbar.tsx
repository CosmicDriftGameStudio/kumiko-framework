import { Search, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { UNIFORM_BAR_CONTROLS_CLASSES } from "../../layout/uniform-bar-controls.ts";
import { cn } from "../../lib/cn.ts";
import { Button as UiButton } from "../../ui/button.tsx";
import { buildFacetCluster } from "./facet-cluster.tsx";
import { hasSortOptionsSelect, SortOptionsSelect } from "./sort-options-select.tsx";
import { ToolbarEndCluster, toolbarEndHasContent } from "./toolbar-end-cluster.tsx";
import type { DataTableModel } from "./use-data-table-state.ts";

function isBehindFilter(
  m: DataTableModel,
  facet: NonNullable<DataTableModel["filterFacets"]>[number],
): boolean {
  return facet.narrowPlacement === "behind-filter" && m.belowSm && m.fillsHeight;
}

function hasBehindFilterFacets(m: DataTableModel): boolean {
  return (m.filterFacets ?? []).some((facet) => isBehindFilter(m, facet));
}

function hasActiveBehindFilterFacet(m: DataTableModel): boolean {
  return (m.filterFacets ?? []).some(
    (facet) => isBehindFilter(m, facet) && (m.filterValues?.[facet.field]?.length ?? 0) > 0,
  );
}

/** Facets that open behind the filter icon on a phone; the rest stays in the inline cluster. */
export function buildBehindFilterCluster(m: DataTableModel): ReactNode {
  const behind = (m.filterFacets ?? []).filter((facet) => isBehindFilter(m, facet));
  if (behind.length === 0) return undefined;
  return buildFacetCluster({
    filterFacets: behind,
    filterValues: m.filterValues,
    onFilterChange: m.onFilterChange,
    dense: false,
    pills: false,
  });
}

export function buildModelFacetCluster(m: DataTableModel): ReactNode {
  return buildFacetCluster({
    filterFacets: m.filterFacets?.filter((facet) => !isBehindFilter(m, facet)),
    filterValues: m.filterValues,
    onFilterChange: m.onFilterChange,
    onFilterReset: m.onFilterReset,
    dateRangeFacets: m.dateRangeFacets,
    onDateRangeChange: m.onDateRangeChange,
    rangeFacets: m.rangeFacets,
    onRangeChange: m.onRangeChange,
    resetAll: m.resetAll,
    notice: m.notice,
    dense: m.fillsHeight,
    pills: m.narrowFacets === "pills" && m.belowSm,
  });
}

export function hasToolbarContent(m: DataTableModel, facetCluster: ReactNode): boolean {
  return (
    m.toolbarStart !== undefined ||
    facetCluster !== undefined ||
    hasBehindFilterFacets(m) ||
    hasVisibleSortOptions(m) ||
    toolbarEndHasContent(m.view, m.exportList, m.toolbarEnd)
  );
}

// The toolbar select is max-md:hidden; below md the card sort bar owns sorting, so a toolbar
// holding only the hidden select would render an empty row.
function hasVisibleSortOptions(m: DataTableModel): boolean {
  return (
    !(m.toolbarSort === true ? m.belowSm : m.isNarrow) &&
    hasSortOptionsSelect(m.sortOptions, m.onSortChange)
  );
}

function toolbarClassName({ fillsHeight, isNarrow }: DataTableModel): string {
  if (!fillsHeight) return cn("flex flex-wrap items-center", UNIFORM_BAR_CONTROLS_CLASSES, "gap-3");
  return cn(
    "flex flex-wrap items-center",
    UNIFORM_BAR_CONTROLS_CLASSES,
    isNarrow ? "shrink-0 gap-2 p-3" : "min-h-13 shrink-0 gap-2 px-6 py-2 md:py-0",
  );
}

// min-w-48: without a floor, flex shrinks the search instead of wrapping the facet cluster onto its own line.
function renderToolbarStart(m: DataTableModel, toolbarStart: ReactNode): ReactNode {
  return (
    <div
      className={cn(
        m.fillsHeight
          ? "relative w-full md:w-[300px] max-md:flex-1 [&_input]:border-border-strong [&_input]:pl-8 [&_input]:max-md:h-11"
          : "flex-1 min-w-48 max-w-sm",
      )}
    >
      {m.fillsHeight && (
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
      )}
      {toolbarStart}
    </div>
  );
}

function renderFacetToggle(m: DataTableModel, facetCluster: ReactNode): ReactNode {
  const { testId, facetsOpenNarrow, setFacetsOpenNarrow } = m;
  const hasActiveFacet = hasActiveBehindFilterFacet(m);
  return (
    <>
      <UiButton
        type="button"
        variant="outline"
        size="icon"
        // Like a set select pill: a facet that waits behind the toggle stays visible while the panel is closed.
        className={cn("size-11", hasActiveFacet && "border-primary text-primary")}
        data-active={hasActiveFacet}
        aria-label={m.tableTranslate?.("kumiko.list.filter.toggle") ?? "Filter"}
        aria-expanded={facetsOpenNarrow}
        data-testid={testId !== undefined ? `${testId}-filter-toggle` : "filter-toggle"}
        onClick={() => setFacetsOpenNarrow((open) => !open)}
      >
        <SlidersHorizontal className="size-4" aria-hidden="true" />
      </UiButton>
      {facetsOpenNarrow && <div className="w-full">{facetCluster}</div>}
    </>
  );
}

// With only end content (no search, no facets) the row has room for the description,
// so both share one line instead of stacking the description under the actions.
export function toolbarMergesDescription(m: DataTableModel, facetCluster: ReactNode): boolean {
  return (
    m.toolbarDescription !== undefined &&
    m.toolbarStart === undefined &&
    facetCluster === undefined &&
    toolbarEndHasContent(m.view, m.exportList, m.toolbarEnd)
  );
}

function renderSortOptions(m: DataTableModel): ReactNode {
  const { sortOptions, onSortChange, testId } = m;
  if (onSortChange === undefined || !hasSortOptionsSelect(sortOptions, onSortChange)) {
    return null;
  }
  return (
    <SortOptionsSelect
      options={sortOptions}
      sort={m.sort}
      onSortChange={onSortChange}
      testId={testId !== undefined ? `${testId}-sort-options` : "render-list-sort-options"}
      className={m.toolbarSort === true ? "max-sm:hidden" : "max-md:hidden"}
      bordered={m.toolbarSort === true}
    />
  );
}

function hasOnlySelectFacets(m: DataTableModel): boolean {
  return (
    (m.filterFacets ?? []).some((facet) => !isBehindFilter(m, facet)) &&
    (m.dateRangeFacets?.length ?? 0) === 0 &&
    (m.rangeFacets?.length ?? 0) === 0
  );
}

// Facets that wait behind the filter icon and the rest of the cluster share one toggle panel,
// never two toggles.
function renderFacetArea(m: DataTableModel, facetCluster: ReactNode): ReactNode {
  const behindFilter = buildBehindFilterCluster(m);
  if (!m.belowSm || (facetCluster === undefined && behindFilter === undefined)) {
    return facetCluster;
  }
  if (facetCluster !== undefined && hasOnlySelectFacets(m)) {
    const inline = <div className="flex w-full flex-wrap gap-2">{facetCluster}</div>;
    if (behindFilter === undefined) return inline;
    return (
      <>
        {renderFacetToggle(m, behindFilter)}
        {inline}
      </>
    );
  }
  if (!m.fillsHeight) return facetCluster;
  return renderFacetToggle(
    m,
    <>
      {behindFilter}
      {facetCluster}
    </>,
  );
}

export function renderToolbar(m: DataTableModel, facetCluster: ReactNode): ReactNode {
  const { testId, toolbarStart } = m;
  const mergesDescription = toolbarMergesDescription(m, facetCluster);
  return (
    <div
      data-testid={testId !== undefined ? `${testId}-toolbar` : "render-list-toolbar"}
      className={cn(
        toolbarClassName(m),
        mergesDescription && "justify-between",
        mergesDescription && m.fillsHeight && !m.isNarrow && "md:py-2",
        // A dashboard panel head above has no inset; the toolbar shares its edges like the table below.
        m.fillsHeight && m.insideEmbeddedScreen && "px-0",
      )}
    >
      {mergesDescription && renderToolbarDescription(m, true, true)}
      {toolbarStart !== undefined && renderToolbarStart(m, toolbarStart)}
      {renderFacetArea(m, facetCluster)}
      {renderSortOptions(m)}
      <ToolbarEndCluster
        view={m.view}
        columnLabels={new Map(m.schemaColumns.map((col) => [col.field, col.label]))}
        exportList={m.exportList}
        toolbarEnd={m.toolbarEnd}
      />
    </div>
  );
}

export function renderToolbarDescription(
  m: DataTableModel,
  hasToolbar: boolean,
  inToolbarRow = false,
): ReactNode {
  const { testId, toolbarDescription, fillsHeight, isNarrow } = m;
  if (toolbarDescription === undefined) return null;
  return (
    <p
      data-testid={testId !== undefined ? `${testId}-description` : "render-list-description"}
      className={cn(
        "m-0 text-sm text-muted-foreground max-sm:hidden",
        // min-w-48 lets the actions wrap below the text instead of squeezing it.
        inToolbarRow ? "min-w-48 flex-1" : "pb-2",
        !inToolbarRow && fillsHeight && (isNarrow ? "px-3" : "px-6"),
        !inToolbarRow && fillsHeight && !hasToolbar && "pt-4",
      )}
    >
      {toolbarDescription}
    </p>
  );
}

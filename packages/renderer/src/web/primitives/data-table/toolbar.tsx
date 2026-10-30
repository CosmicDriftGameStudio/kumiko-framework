import { Search, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { UNIFORM_BAR_CONTROLS_CLASSES } from "../../layout/uniform-bar-controls.ts";
import { cn } from "../../lib/cn.ts";
import { Button as UiButton } from "../../ui/button.tsx";
import { buildFacetCluster } from "./facet-cluster.tsx";
import { ToolbarEndCluster, toolbarEndHasContent } from "./toolbar-end-cluster.tsx";
import type { DataTableModel } from "./use-data-table-state.ts";

export function buildModelFacetCluster(m: DataTableModel): ReactNode {
  return buildFacetCluster({
    filterFacets: m.filterFacets,
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
  });
}

export function hasToolbarContent(m: DataTableModel, facetCluster: ReactNode): boolean {
  return (
    m.toolbarStart !== undefined ||
    facetCluster !== undefined ||
    toolbarEndHasContent(m.view, m.exportList, m.toolbarEnd)
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
  return (
    <>
      <UiButton
        type="button"
        variant="outline"
        size="icon"
        className="size-11"
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

export function renderToolbar(m: DataTableModel, facetCluster: ReactNode): ReactNode {
  const { testId, toolbarStart } = m;
  const collapsesFacetsBehindButton = m.isNarrow && m.fillsHeight && facetCluster !== undefined;
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
      {collapsesFacetsBehindButton ? renderFacetToggle(m, facetCluster) : facetCluster}
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
        "m-0 text-sm text-muted-foreground",
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

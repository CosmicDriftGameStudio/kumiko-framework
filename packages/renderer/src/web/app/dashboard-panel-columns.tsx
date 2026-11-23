import type { DashboardPanelDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";

const GRID_CLASS = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12";
const COLUMNS_CLASS = "grid grid-cols-1 gap-4 lg:grid-cols-3";
const WIDE_SIDE_COLUMNS_CLASS = "grid grid-cols-1 gap-4 lg:grid-cols-5";
const COLUMN_CLASS = "flex min-w-0 flex-col gap-4";

/** Panel grid, or the main/side columns of `layout: "main-side"`; below sm everything is one list in `narrowOrder`. */
export function DashboardPanelGrid({
  layout,
  sideWidth,
  panels,
  belowSm,
  renderPanel,
}: {
  readonly layout: "main-side" | undefined;
  readonly sideWidth: "wide" | undefined;
  readonly panels: readonly DashboardPanelDefinition[];
  readonly belowSm: boolean;
  readonly renderPanel: (panel: DashboardPanelDefinition) => ReactNode;
}): ReactNode {
  if (layout !== "main-side" || belowSm) {
    return (
      <div className={layout === "main-side" ? COLUMN_CLASS : GRID_CLASS}>
        {panels.map(renderPanel)}
      </div>
    );
  }
  const wide = sideWidth === "wide";
  const topPanels = panels.filter((panel) => panel.column === "top");
  return (
    <div className={COLUMN_CLASS}>
      {topPanels.length > 0 && (
        <div className={COLUMN_CLASS} data-testid="dashboard-column-top">
          {topPanels.map(renderPanel)}
        </div>
      )}
      <div
        className={wide ? WIDE_SIDE_COLUMNS_CLASS : COLUMNS_CLASS}
        data-testid="dashboard-columns"
      >
        <div
          className={`${COLUMN_CLASS} ${wide ? "lg:col-span-3" : "lg:col-span-2"}`}
          data-testid="dashboard-column-main"
        >
          {panels
            .filter((panel) => panel.column !== "side" && panel.column !== "top")
            .map(renderPanel)}
        </div>
        <div
          className={wide ? `${COLUMN_CLASS} lg:col-span-2` : COLUMN_CLASS}
          data-testid="dashboard-column-side"
        >
          {panels.filter((panel) => panel.column === "side").map(renderPanel)}
        </div>
      </div>
    </div>
  );
}

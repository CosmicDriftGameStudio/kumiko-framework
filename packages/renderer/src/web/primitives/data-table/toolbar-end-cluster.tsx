import type { ReactNode } from "react";
import type { DataTableExport, DataTableViewOptions } from "../../../data-table-view-types.ts";
import { ExportButton } from "./export-button.tsx";
import { ViewMenu, viewHasMenu } from "./view-menu.tsx";

export function toolbarEndHasContent(
  view: DataTableViewOptions | undefined,
  exportList: DataTableExport | undefined,
  toolbarEnd: ReactNode,
): boolean {
  return toolbarEnd !== undefined || viewHasMenu(view) || exportList !== undefined;
}

/** Right-hand toolbar group: view menu, export button, then the caller's own end content. */
export function ToolbarEndCluster({
  view,
  columnLabels,
  exportList,
  toolbarEnd,
}: {
  readonly view: DataTableViewOptions | undefined;
  readonly columnLabels: ReadonlyMap<string, string>;
  readonly exportList: DataTableExport | undefined;
  readonly toolbarEnd: ReactNode;
}): ReactNode {
  if (!toolbarEndHasContent(view, exportList, toolbarEnd)) return null;
  const showsViewMenu = viewHasMenu(view);
  return (
    <div className="flex flex-wrap items-center gap-2 ml-auto">
      {showsViewMenu && <ViewMenu view={view} columnLabels={columnLabels} />}
      {exportList !== undefined && <ExportButton source={exportList} />}
      {toolbarEnd}
    </div>
  );
}

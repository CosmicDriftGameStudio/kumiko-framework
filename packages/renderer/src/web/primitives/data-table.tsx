import type { ReactNode } from "react";
import type { DataTableProps } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { renderTableContent } from "./data-table/table-content.tsx";
import {
  buildModelFacetCluster,
  hasToolbarContent,
  renderToolbar,
  renderToolbarDescription,
  toolbarMergesDescription,
} from "./data-table/toolbar.tsx";
import { type DataTableModel, useDataTableState } from "./data-table/use-data-table-state.ts";
import { screenPaddingClassName } from "./layout.tsx";

// `screenPadding`: on a list screen this wrapper IS the screen container,
// so it takes the same token as FormScreenShell/PageSection instead of its
// own inset — a list ends at the same footer distance as a form.
// Explicit `false` (vs. the default/omitted case) means a host that
// already pads its own children — a relatedList section nested in a
// tabs-mode Card — so this wrapper adds no inset of its
// own, or its content would sit ~24px deeper than sibling banners in the
// same Card body.
function screenPaddingOf(screenPadding: boolean | undefined): string | undefined {
  if (screenPadding === true) return screenPaddingClassName;
  return screenPadding === false ? undefined : "p-6";
}

function wrapperClassName({ fillsHeight, screenPadding }: DataTableModel): string {
  return cn(
    "flex flex-col w-full",
    // scrollBody: the wrapper fills its container so the footer sits at the
    // same spot at 3 and 300 rows; the 24px insets live in toolbar, cells
    // and footer, so no outer padding.
    fillsHeight ? "h-full min-h-0" : cn("gap-4", screenPaddingOf(screenPadding)),
  );
}

export function DefaultDataTable(props: DataTableProps): ReactNode {
  const model = useDataTableState(props);
  const facetCluster = buildModelFacetCluster(model);
  const hasToolbar = hasToolbarContent(model, facetCluster);
  const mergesDescription = toolbarMergesDescription(model, facetCluster);

  // dashboard-01 pattern: the toolbar (search + facets + "+ New") sits ABOVE
  // the table in the same padding block; no separate bg bar, no screen title
  // (that lives in the shell's breadcrumb). The toolbar is NOT sticky: lists
  // typically scroll with the page container, not internally. Sticky would
  // compete with the topbar.
  return (
    <div className={wrapperClassName(model)}>
      {/* An embedded table sits under its section title, so the description reads first
          there; a full-height list keeps it below the toolbar it pads against. */}
      {!mergesDescription && !model.fillsHeight && renderToolbarDescription(model, hasToolbar)}
      {hasToolbar && renderToolbar(model, facetCluster)}
      {!mergesDescription && model.fillsHeight && renderToolbarDescription(model, hasToolbar)}
      {renderTableContent(model)}
    </div>
  );
}

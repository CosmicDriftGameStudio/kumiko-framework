import type { ReactNode } from "react";
import { useState } from "react";
import type { Translate } from "../headless/index.ts";
import { useTranslation } from "../i18n.tsx";
import { usePageHeaderCompact, usePageHeaderSlotAvailable } from "../page-header-slot.ts";
import { usePrimitives } from "../primitives.tsx";
import { renderReferenceLookupBridges } from "./render-list-reference-bridge.tsx";
import {
  tableChromeProps,
  tableFilterProps,
  tableLayoutProps,
  tableRowProps,
  tableSortPagingProps,
} from "./render-list-table-props.ts";
import {
  composeEmptyState,
  type ListToolbarModel,
  renderCreateButton,
  renderHeaderActions,
  renderMenuActionError,
  renderPageHeader,
  renderSearchInput,
  renderToolbarEnd,
} from "./render-list-toolbar.tsx";
import type { ToolbarActionButton } from "./render-list-toolbar-action.tsx";
import {
  buildPromotedMenuItems,
  resolveItemNoun,
  resolveToolbarLabels,
  resolveToolbarTitle,
  splitToolbarActions,
} from "./render-list-toolbar-model.ts";
import type { RenderListProps } from "./render-list-types.ts";
import { useRenderListColumns } from "./use-render-list-columns.ts";
import { useRenderListSearch } from "./use-render-list-search.ts";

export type { ToolbarActionButton };

// RenderList is a presentational view for entityList screens.
//
// Data and state are fully controlled by the caller (KumikoScreen):
//   - rows come from the server (through the useQuery + URL-state payload)
//   - sort/q are props; RenderList calls onSortChange/onQChange when
//     the user performs UI actions
//   - Search is server-side (via SearchAdapter / Meilisearch). Local state
//     in the search input is only a debounce buffer, not a filter.
//
// Apps that use RenderList without server state (for example, a static
// lookup) provide stable rows and omit sort/q — DataTable then falls back
// to no sort wiring and no search.

export type { RenderListProps } from "./render-list-types.ts";

export function RenderList(props: RenderListProps): ReactNode {
  const {
    screen,
    entity,
    rows,
    featureName,
    translate: translateProp,
    onRowClick,
    emptyState,
    onCreate,
    createLabel,
    searchable = false,
    searchPlaceholder,
    description,
    emptyContent,
    narrowed = false,
    defaultFilterActive: defaultFilterActiveProp = false,
    itemNounKey,
    searchValue,
    onSearchChange,
    sort,
    onSortChange,
    pager,
    onReachEnd,
    loadingMore,
    hasMore,
    rowActions,
    rowActionMode,
    bulk,
    rowTone,
    toolbarActions,
    filterFacets,
    filterValues,
    onFilterChange,
    onFilterReset,
    dateRangeFacets,
    onDateRangeChange,
    chromeless,
    scrollBody,
    screenPadding,
    expandedRowIds,
    onToggleRowExpanded,
    renderExpandedRow,
    ...tableBlockProps
  } = props;
  // As in RenderEdit, fall back to the i18next context for translation;
  // otherwise column headers would display raw i18n keys.
  const t = useTranslation();
  const translate: Translate = translateProp ?? t;
  const { DataTable, Button, Dialog, Input, Banner, PageHeader } = usePrimitives();
  const pageHeaderSlotAvailable = usePageHeaderSlotAvailable();
  const pageHeaderCompact = usePageHeaderCompact();
  const createInPageHeader =
    onCreate !== undefined && PageHeader !== undefined && pageHeaderSlotAvailable;
  // Promoted actions that moved into the phone header's overflow menu have no button of
  // their own, so their busy and error state lives here.
  const [menuActionBusyId, setMenuActionBusyId] = useState<string | null>(null);
  const [menuActionError, setMenuActionError] = useState<string | null>(null);
  const { localQ, setLocalQ } = useRenderListSearch(searchValue, onSearchChange);
  const { referenceColumns, handleLookupMap, enrichedVm } = useRenderListColumns({
    screen,
    entity,
    rows,
    featureName,
    translate,
  });

  const labelInput = {
    screen,
    translate,
    createLabel,
    searchPlaceholder,
    itemNounKey,
    featureName,
  };
  const { effectiveCreateLabel, effectiveSearchPlaceholder } = resolveToolbarLabels(labelInput);
  const itemNoun = resolveItemNoun(labelInput);
  const toolbarStart = searchable
    ? renderSearchInput(Input, localQ, setLocalQ, effectiveSearchPlaceholder)
    : undefined;

  // Toolbar-end slot: an optional header slot (for example, a cap counter,
  // at the left of the right-hand cluster), toolbar actions from the schema,
  // and an optional "+ New" button at the right edge. The header slot lives
  // inside the toolbar row, with the same card frame, rather than as loose
  // text above the screen title. Items retain array order, and "+ New" comes
  // last because it is the most common and prominent CTA.
  const split = splitToolbarActions({
    toolbarActions,
    pageHeaderAvailable: PageHeader !== undefined,
    pageHeaderSlotAvailable,
    pageHeaderCompact,
    createInPageHeader,
  });
  const toolbarModel: ListToolbarModel = {
    screen,
    Button,
    Dialog,
    Banner,
    onCreate,
    createInPageHeader,
    pageHeaderCompact,
    effectiveCreateLabel,
    split,
  };
  const createButton = renderCreateButton(toolbarModel);
  const promotedMenuItems = buildPromotedMenuItems({
    promotedToolbarActions: split.promotedToolbarActions,
    promotedInOverflowMenu: split.promotedInOverflowMenu,
    menuActionBusyId,
    setMenuActionBusyId,
    setMenuActionError,
  });
  const headerActions = renderHeaderActions(toolbarModel, createButton);
  const toolbarEnd = renderToolbarEnd(toolbarModel, createButton);
  const composedEmptyState = composeEmptyState({
    Button,
    emptyState,
    onCreate,
    emptyContent,
    narrowed,
    defaultFilterActive: defaultFilterActiveProp && onFilterReset !== undefined,
    onFilterReset,
    translate,
    createInPageHeader,
    effectiveCreateLabel,
  });
  const toolbarTitle = resolveToolbarTitle(screen, translate);

  return (
    <>
      {headerActions !== undefined &&
        PageHeader !== undefined &&
        renderPageHeader(
          PageHeader,
          headerActions,
          split.promotedInOverflowMenu,
          promotedMenuItems,
        )}
      {menuActionError !== null && renderMenuActionError(Banner, menuActionError)}
      {renderReferenceLookupBridges(referenceColumns, handleLookupMap)}
      <DataTable
        columns={enrichedVm.columns}
        rows={enrichedVm.rows}
        toolbarTitle={toolbarTitle}
        {...tableChromeProps({
          onRowClick,
          composedEmptyState,
          toolbarStart,
          description,
          toolbarEnd,
          itemNoun,
        })}
        {...tableSortPagingProps({ sort, onSortChange, pager, onReachEnd, loadingMore, hasMore })}
        {...tableRowProps({ rowActions, rowActionMode, bulk, rowTone })}
        {...tableFilterProps({
          filterFacets,
          filterValues,
          onFilterChange,
          onFilterReset,
          dateRangeFacets,
          onDateRangeChange,
        })}
        {...tableLayoutProps({
          chromeless,
          scrollBody,
          screenPadding,
          expandedRowIds,
          onToggleRowExpanded,
          renderExpandedRow,
        })}
        {...tableBlockProps}
        testId="render-list-table"
      />
    </>
  );
}

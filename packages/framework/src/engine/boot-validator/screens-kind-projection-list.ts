import { normalizeListColumn } from "../screen-helpers.ts";
import type { ProjectionListScreenDefinition } from "../types/screen.ts";
import { validateListBulkActions } from "./list-bulk-actions.ts";
import { validateListTableOptions } from "./list-table-options.ts";
import {
  assertWriteHandlerRegistered,
  resolveRowActionNavigateTarget,
  validateAtMostOneRowClick,
  validateDrawerTargetAction,
} from "./screens-actions.ts";
import { validateDashboardPanelVisibleWhen } from "./screens-dashboard.ts";
import {
  listActionContext,
  rejectEmptyColumns,
  rejectMissingQuery,
  rejectNonArrayInFilter,
  type ScreenValidationContext,
  validateListColumnRendering,
} from "./screens-kind-shared.ts";
import { validateListActionTargets, validateListFacets } from "./screens-lists.ts";

function validateProjectionListRowActions(
  ctx: ScreenValidationContext,
  screenId: string,
  rowActions: NonNullable<ProjectionListScreenDefinition["rowActions"]>,
): void {
  const listContext = listActionContext(
    ctx,
    screenId,
    "projectionList",
    undefined,
    `Screen "${screenId}" (projectionList)`,
  );
  for (const action of rowActions) {
    validateListActionTargets(listContext, "rowAction", action);
  }
  validateAtMostOneRowClick(ctx.feature.name, screenId, "projectionList", rowActions);
}

// Plain navigate toolbarActions (no tab) have no boot check yet.
function validateProjectionListToolbarActions(
  ctx: ScreenValidationContext,
  screenId: string,
  toolbarActions: NonNullable<ProjectionListScreenDefinition["toolbarActions"]>,
): void {
  const featureName = ctx.feature.name;
  for (const action of toolbarActions) {
    validateDashboardPanelVisibleWhen(
      `[Feature ${featureName}] Screen "${screenId}" (projectionList) toolbarAction "${action.id}"`,
      action.visibleWhen,
    );
    if (action.kind === "drawer") {
      validateDrawerTargetAction(
        featureName,
        screenId,
        "projectionList",
        "toolbarAction",
        action,
        ctx.feature.screens,
      );
    } else if (action.kind === "writeHandler") {
      assertWriteHandlerRegistered(
        featureName,
        `Screen "${screenId}" (projectionList) toolbarAction "${action.id}"`,
        action.handler,
        ctx.allWriteHandlerQns,
      );
    }
    if (action.kind === "navigate" && action.tab !== undefined) {
      resolveRowActionNavigateTarget(
        featureName,
        screenId,
        "projectionList",
        "toolbarAction",
        action,
        ctx.allScreenQns,
        ctx.navTargetShortIds,
        ctx.screensByShortId,
        ctx.detailForScreens,
      );
    }
  }
}

// Query-driven, no entity, so only query + columns are checked (the column
// fields cannot be checked against an entity; they resolve against the
// projection rows at render time).
export function validateProjectionListScreen(
  ctx: ScreenValidationContext,
  screenId: string,
  screen: ProjectionListScreenDefinition,
): void {
  const featureName = ctx.feature.name;
  rejectMissingQuery(featureName, screenId, "projectionList", screen.query);
  rejectEmptyColumns(featureName, screenId, "projectionList", screen.columns.length);
  for (const col of screen.columns) {
    validateListColumnRendering(ctx, screenId, "projectionList", normalizeListColumn(col));
  }
  validateListTableOptions(
    `[Feature ${featureName}] Screen "${screenId}" (projectionList)`,
    screen.table,
    screen.columns,
    true,
  );
  // Screen filter: field existence can't be checked without an entity (columns
  // aren't a complete field inventory of the underlying query), so only the
  // structure is pinned: "in" requires an array.
  if (screen.filter !== undefined) {
    rejectNonArrayInFilter(featureName, screenId, "projectionList", screen.filter);
  }
  if (screen.facets !== undefined) {
    validateListFacets(
      `[Feature ${featureName}] Screen "${screenId}" (projectionList)`,
      screen.facets,
      screen.columns,
      featureName,
      ctx.featureMap,
    );
  }
  if (screen.rowActions !== undefined) {
    validateProjectionListRowActions(ctx, screenId, screen.rowActions);
  }
  validateListBulkActions(
    `[Feature ${featureName}] Screen "${screenId}" (projectionList)`,
    screen.bulkActions,
    screen.rowActions,
  );
  if (screen.toolbarActions !== undefined) {
    validateProjectionListToolbarActions(ctx, screenId, screen.toolbarActions);
  }
}

import type {
  ProjectionListScreenDefinition,
  RowActionNavigate,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { useCallback, useMemo } from "react";
import type { useOptionalDispatcher } from "../context/dispatcher-context.tsx";
import type { useUserRoles } from "../context/user-roles-context.tsx";
import type { ListRowViewModel, Translate } from "../headless/index.ts";
import type { useDrawerAction } from "./action-form-body.tsx";
import type { useAppFeatures } from "./app-features-context.tsx";
import type { useClientActionRuntime } from "./client-actions.tsx";
import { useListBulk } from "./list-bulk-actions.ts";
import { useListEmptyContent } from "./list-empty-content.ts";
import type { useNav } from "./nav.tsx";
import type { useReturnHost } from "./return-to.tsx";
import {
  buildDefaultEditRowAction,
  buildProjectionRowActions,
  buildProjectionToolbarActions,
  runProjectionRowNavigate,
} from "./row-actions.ts";
import type { useProjectionListDefinitions } from "./use-projection-list-definitions.ts";

type ProjectionListActionsInput = {
  readonly screen: ProjectionListScreenDefinition;
  readonly effectiveTranslate: Translate;
  readonly dispatcher: ReturnType<typeof useOptionalDispatcher>;
  readonly clientActions: ReturnType<typeof useClientActionRuntime>;
  readonly nav: ReturnType<typeof useNav>;
  readonly host: ReturnType<typeof useReturnHost>;
  readonly refreshRows: () => Promise<void>;
  readonly openDrawer: ReturnType<typeof useDrawerAction>["openDrawer"];
  readonly appFeatures: ReturnType<typeof useAppFeatures>;
  readonly userRoles: ReturnType<typeof useUserRoles>;
  readonly defaultEditScreen: ReturnType<typeof useProjectionListDefinitions>["defaultEditScreen"];
};

export function useProjectionListActions(input: ProjectionListActionsInput) {
  const {
    screen,
    effectiveTranslate,
    dispatcher,
    clientActions,
    nav,
    host,
    refreshRows,
    openDrawer,
    appFeatures,
    userRoles,
    defaultEditScreen,
  } = input;
  // Entity targets: see EntityListBody.runNavigate for why the resolution happens
  // in the NavApi impl. Unlike there: NO row["id"]
  // fallback — projectionList rows come from an arbitrary query projection
  // with no guaranteed "id" field. The boot validator therefore enforces an
  // explicit entityId for projectionList entity targets. Same helper
  // relatedList's rowActions reuse (related-list-section.tsx) — a
  // projectionDetail relatedList row has the identical "no guaranteed id"
  // shape.
  const runNavigate = useCallback(
    (action: RowActionNavigate, row: ListRowViewModel) =>
      runProjectionRowNavigate(nav, action, row, host),
    [nav, host],
  );

  const defaultEditRowAction = useMemo(
    () => buildDefaultEditRowAction(defaultEditScreen),
    [defaultEditScreen],
  );

  const rowActions = useMemo(
    () =>
      buildProjectionRowActions({
        rowActions: screen.rowActions,
        translate: effectiveTranslate,
        dispatcher,
        nav,
        refetch: refreshRows,
        openDrawer,
        defaultEditRowAction,
        host,
        clientActions,
      }),
    [
      screen.rowActions,
      effectiveTranslate,
      dispatcher,
      clientActions,
      nav,
      refreshRows,
      openDrawer,
      defaultEditRowAction,
      host,
    ],
  );

  const toolbarActions = useMemo(
    () =>
      buildProjectionToolbarActions({
        toolbarActions: screen.toolbarActions,
        translate: effectiveTranslate,
        dispatcher,
        nav,
        refetch: refreshRows,
        openDrawer,
        host,
        access: { appFeatures, userRoles },
      }),
    [
      screen.toolbarActions,
      effectiveTranslate,
      nav,
      host,
      dispatcher,
      refreshRows,
      openDrawer,
      appFeatures,
      userRoles,
    ],
  );
  const bulk = useListBulk({
    bulkActions: screen.bulkActions,
    rowActions: screen.rowActions,
    translate: effectiveTranslate,
    dispatcher,
    reload: refreshRows,
  });
  const emptyContent = useListEmptyContent(screen.emptyState, effectiveTranslate, {
    nav,
    host,
    dispatcher,
    openDrawer,
    onWriteSuccess: refreshRows,
  });
  return { runNavigate, rowActions, toolbarActions, bulk, emptyContent };
}

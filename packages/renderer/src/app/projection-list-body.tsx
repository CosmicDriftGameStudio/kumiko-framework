import type { ProjectionListScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import { ListGroupPageBridges } from "../components/list-group-page-bridges.tsx";
import { useOptionalDispatcher } from "../context/dispatcher-context.tsx";
import { useIsEmbeddedScreen } from "../context/embedded-screen-context.tsx";
import { useUserRoles } from "../context/user-roles-context.tsx";
import type { ListRowViewModel, Translate } from "../headless/index.ts";
import { useTranslation } from "../i18n.tsx";
import { usePrimitives } from "../primitives.tsx";
import { useDrawerAction } from "./action-form-body.tsx";
import { useAppFeatures } from "./app-features-context.tsx";
import { useClientActionRuntime } from "./client-actions.tsx";
import type { FeatureSchema } from "./feature-schema.ts";
import { useNav } from "./nav.tsx";
import { renderProjectionDrawerHost } from "./projection-drawer-host.tsx";
import {
  renderBadShapeBanner,
  renderProjectionList,
  renderQueryRetryBanner,
} from "./projection-list-render.tsx";
import { resolveWrappedRowClick } from "./projection-list-row-click.ts";
import { QueryLoadingBanner } from "./query-state-banners.tsx";
import { ReferenceFacetBridges } from "./reference-facet-bridge.tsx";
import { useReturnHost } from "./return-to.tsx";
import { useProjectionListActions } from "./use-projection-list-actions.ts";
import { useProjectionListData } from "./use-projection-list-data.ts";
import { useProjectionListDefinitions } from "./use-projection-list-definitions.ts";
import { useProjectionListQuery } from "./use-projection-list-query.ts";
import { listPager } from "./use-screen-list-rows.ts";

// ---- projection-list ----

// Like entityList, but the list query comes DIRECTLY from `screen.query`
// (instead of being derived from an entity) — cross-feature capable.
// search/sort/pagination reuse the same URL-state + buildListQueryPayload
// wiring as EntityListBody; which of them are actually offered is derived
// from the query handler's Zod schema at buildAppSchema time, not
// declared here. Pages-mode pagination only — infinite-scroll accumulation
// isn't wired for projectionList.
export function ProjectionListBody({
  schema,
  screen,
  translate,
  onRowClick,
}: {
  readonly schema: FeatureSchema;
  readonly screen: ProjectionListScreenDefinition;
  readonly translate?: Translate;
  readonly onRowClick?: (row: ListRowViewModel, entityName: string) => void;
}): ReactNode {
  const isEmbeddedScreen = useIsEmbeddedScreen();
  const { Banner, Text } = usePrimitives();
  const t = useTranslation();
  const nav = useNav();
  const host = useReturnHost();
  const dispatcher = useOptionalDispatcher();
  const clientActions = useClientActionRuntime();
  const effectiveTranslate = translate ?? t;
  const userRoles = useUserRoles();
  const appFeatures = useAppFeatures();
  const drawer = useDrawerAction(schema);
  const { openDrawer } = drawer;
  const definitions = useProjectionListDefinitions(screen, appFeatures, userRoles);
  const { defaultEditScreen, searchable, sortable, paginated, entity } = definitions;
  const query = useProjectionListQuery({
    screen,
    featureName: schema.featureName,
    effectiveTranslate,
    entity,
    searchable,
    sortable,
    paginated,
  });
  const data = useProjectionListData({
    screen,
    featureName: schema.featureName,
    queryPayload: query.queryPayload,
    limit: query.limit,
    usePager: query.usePager,
    effectiveTranslate,
    resolvedFacetSpecs: query.resolvedFacetSpecs,
  });
  const { listRows } = data;
  const refreshRows = listRows.refreshAfterWrite;
  const actions = useProjectionListActions({
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
  });

  if (listRows.firstLoad) {
    return <QueryLoadingBanner />;
  }
  if (listRows.error && !listRows.hasData) {
    return renderQueryRetryBanner(listRows, listRows.error, effectiveTranslate);
  }
  // A failed refetch keeps the last good data on screen.
  const refetchErrorBanner = listRows.error
    ? renderQueryRetryBanner(listRows, listRows.error, effectiveTranslate)
    : null;

  // listRows.page is typed as PagedRows but the query handler is free to
  // return anything at runtime (a bare array silently rendered an empty
  // table instead of surfacing the mismatch), so the shape is checked.
  if (listRows.page !== null && !Array.isArray(listRows.page.rows)) {
    return renderBadShapeBanner(screen, { Banner, Text });
  }

  const wrappedOnRowClick = resolveWrappedRowClick({
    screen,
    onRowClick,
    entityName: definitions.listScreen.entity,
    openDrawer,
    runNavigate: actions.runNavigate,
  });

  // Same pager-construction as EntityListBody: no Pager UI until the
  // server-provided `total` arrives (guards pagination="pages" without
  // totalCount support).
  const pager = listPager({
    usePager: query.usePager,
    page: listRows.page,
    limit: query.limit,
    urlState: query.urlState,
  });

  return (
    <>
      {refetchErrorBanner}
      {actions.toolbarGateQueries}
      <ListGroupPageBridges {...data.listTable.aggregates.groupPages} />
      <ReferenceFacetBridges
        specs={query.facetSpecs}
        onOptions={query.handleProjectionFacetOptions}
      />
      {renderProjectionList({
        schema,
        screen,
        translate,
        effectiveTranslate,
        isEmbeddedScreen,
        definitions,
        query,
        data,
        actions,
        pager,
        wrappedOnRowClick,
      })}
      {renderProjectionDrawerHost({
        schema,
        translate,
        userRoles,
        drawer,
        refreshRows,
      })}
    </>
  );
}

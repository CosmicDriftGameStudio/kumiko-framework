import type {
  ProjectionListScreenDefinition,
  RowActionNavigate,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { ListGroupPageBridges } from "../components/list-group-page-bridges.tsx";
import { RenderList } from "../components/render-list.tsx";
import { useOptionalDispatcher } from "../context/dispatcher-context.tsx";
import { useIsEmbeddedScreen } from "../context/embedded-screen-context.tsx";
import { useUserRoles } from "../context/user-roles-context.tsx";
import type { ListRowViewModel, Translate } from "../headless/index.ts";
import { useListUrlState } from "../hooks/use-list-url-state.ts";
import { useTranslation } from "../i18n.tsx";
import { type DataTableFacet, usePrimitives } from "../primitives.tsx";
import { screenFillsHeight } from "../screen-fills-height.ts";
import { DrawerHost, useDrawerAction } from "./action-form-body.tsx";
import { useAppFeatures } from "./app-features-context.tsx";
import { useClientActionRuntime } from "./client-actions.tsx";
import type { FeatureSchema } from "./feature-schema.ts";
import { useListBulk } from "./list-bulk-actions.ts";
import { isListNarrowed, useListEmptyContent } from "./list-empty-content.ts";
import {
  buildFilterFacets,
  buildFilterPayload,
  mergeReferenceFacetOptions,
  resolveProjectionFacetSpecs,
} from "./list-facets.ts";
import { useNav } from "./nav.tsx";
import { synthesizeProjectionEntity, synthesizeProjectionScreen } from "./projection-list-shim.ts";
import { QueryErrorBanner, QueryLoadingBanner } from "./query-state-banners.tsx";
import { ReferenceFacetBridges, type ReferenceFacetOption } from "./reference-facet-bridge.tsx";
import { useReturnHost } from "./return-to.tsx";
import {
  buildDefaultEditRowAction,
  buildProjectionRowActions,
  buildProjectionToolbarActions,
  findRowClickAction,
  runDrawerRowAction,
  runProjectionRowNavigate,
} from "./row-actions.ts";
import { findEditScreenFor } from "./screen-access.ts";
import { buildListQueryPayload } from "./screen-shared.tsx";
import { useProjectionDateRange } from "./use-projection-date-range.ts";
import { listPager, useScreenListRows } from "./use-screen-list-rows.ts";
import { useScreenListTable } from "./use-screen-list-table.ts";

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
  const { drawerAction, drawerScreen, drawerInitialValues, openDrawer, closeDrawer } =
    useDrawerAction(schema);
  const defaultEditScreen = useMemo(() => {
    const detailFor = screen.detailFor;
    if (detailFor === undefined) return undefined;
    return findEditScreenFor(detailFor, appFeatures, userRoles);
  }, [appFeatures, screen.detailFor, userRoles]);

  // searchable/sortable/paginated are derived at buildAppSchema time from the
  // query handler's Zod schema — not authored on the screen.
  const searchable = screen.searchable ?? false;
  const sortable = screen.sortable ?? false;
  const paginated = screen.paginated ?? false;
  const entity = useMemo(
    () => synthesizeProjectionEntity(screen.columns, sortable),
    [screen.columns, sortable],
  );
  const listScreen = useMemo(() => synthesizeProjectionScreen(screen), [screen]);

  const urlState = useListUrlState(screen.id);
  // Gated on the derived capability, not just on whether URL-state happens to
  // carry a value — a stale/hand-crafted URL (?…q=x on a non-searchable
  // screen) must not smuggle a param the query's Zod schema doesn't accept.
  const activeSearch = searchable ? urlState.q : "";
  // Same predicate that makes a header clickable: a stale link onto a
  // sortable:false/unknown column must not reach the server (it answers 400).
  const urlSort = urlState.sort;
  const urlSortField = urlSort === null ? undefined : entity.fields[urlSort.field];
  const urlSortAllowed =
    urlSortField !== undefined && "sortable" in urlSortField && urlSortField.sortable === true;
  const activeSort = sortable
    ? ((urlSortAllowed ? urlSort : null) ?? screen.defaultSort ?? null)
    : null;
  const limit = urlState.pageSize ?? screen.pageSize ?? 50;
  // Pages-mode only (see header comment) — an author-set pagination:
  // "infinite" on a paginated projectionList is silently a no-op today.
  const usePager = paginated && (screen.pagination ?? "pages") === "pages";

  // Facets — a projectionList has no entity, so screen.facets is
  // the only field inventory; resolveProjectionFacetSpecs reshapes +
  // translates its explicit labels into the same ResolvedFacetSpec the
  // entityList adapter produces, so both feed the same
  // buildFilterFacets/buildFilterPayload.
  const facetSpecs = useMemo(
    () => resolveProjectionFacetSpecs(screen.facets, effectiveTranslate, schema.featureName),
    [screen.facets, effectiveTranslate, schema.featureName],
  );
  const [projectionReferenceFacetOptions, setProjectionReferenceFacetOptions] = useState<
    Record<string, readonly ReferenceFacetOption[]>
  >({});
  const handleProjectionFacetOptions = useCallback(
    (field: string, options: readonly ReferenceFacetOption[]) =>
      setProjectionReferenceFacetOptions((prev) =>
        prev[field] === options ? prev : { ...prev, [field]: options },
      ),
    [],
  );
  const resolvedFacetSpecs = useMemo(
    () => mergeReferenceFacetOptions(facetSpecs, projectionReferenceFacetOptions),
    [facetSpecs, projectionReferenceFacetOptions],
  );
  const filterPayload = useMemo(
    () =>
      buildFilterPayload(
        urlState.filters,
        (field) => facetSpecs.find((spec) => spec.field === field)?.type,
      ),
    [urlState.filters, facetSpecs],
  );

  const { dateRangePayload, dateRangeFacets, handleDateRangeChange } = useProjectionDateRange(
    screen.facets,
    effectiveTranslate,
    urlState,
  );

  const queryPayload = useMemo(() => {
    const payload = buildListQueryPayload({
      limit,
      search: activeSearch,
      sort: activeSort,
      usePager,
      page: urlState.page,
      useInfinite: false,
      cursor: undefined,
    });
    // Gated on screen.filter/screen.facets being declared (not just on
    // urlState/filterPayload happening to carry a value) — same rule as
    // activeSearch/activeSort above: a stale URL must not smuggle a param
    // the bound query's Zod schema doesn't accept.
    if (screen.filter !== undefined) {
      payload["filter"] = screen.filter;
    }
    if (screen.facets !== undefined && filterPayload.length > 0) {
      payload["filters"] = filterPayload;
    }
    Object.assign(payload, dateRangePayload);
    return payload;
  }, [
    limit,
    activeSearch,
    activeSort,
    usePager,
    urlState.page,
    screen.filter,
    screen.facets,
    filterPayload,
    dateRangePayload,
  ]);

  const facetFilterFields = useMemo(
    () => (screen.facets ?? []).map((facet) => facet.field),
    [screen.facets],
  );
  const listTable = useScreenListTable({
    screen,
    featureName: schema.featureName,
    payload: queryPayload,
    filterFields: facetFilterFields,
    queryType: screen.query,
    pageSize: limit,
    paging: usePager ? "offset" : "cursor",
    translate: effectiveTranslate,
  });
  const listRows = useScreenListRows({
    queryType: screen.query,
    payload: queryPayload,
    infinite: false,
    aggregates: listTable.aggregates,
  });
  const refreshRows = listRows.refreshAfterWrite;

  const filterFacets = useMemo<DataTableFacet[]>(
    () => buildFilterFacets(resolvedFacetSpecs),
    [resolvedFacetSpecs],
  );
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

  if (listRows.firstLoad) {
    return <QueryLoadingBanner />;
  }
  if (listRows.error && !listRows.hasData) {
    return (
      <QueryErrorBanner
        error={listRows.error}
        translate={effectiveTranslate}
        onRetry={listRows.retry}
      />
    );
  }
  // A failed refetch keeps the last good data on screen.
  const refetchErrorBanner = listRows.error ? (
    <QueryErrorBanner
      error={listRows.error}
      translate={effectiveTranslate}
      onRetry={listRows.retry}
    />
  ) : null;

  // listRows.page is typed as PagedRows but the query handler is free to
  // return anything at runtime (a bare array silently rendered an empty
  // table instead of surfacing the mismatch), so the shape is checked.
  if (listRows.page !== null && !Array.isArray(listRows.page.rows)) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-projection-list-bad-shape">
        Screen <Text variant="code">{screen.id}</Text> query{" "}
        <Text variant="code">{screen.query}</Text> did not return a PagedRows envelope; a
        projectionList query must return <Text variant="code">{"{ rows, nextCursor }"}</Text>.
      </Banner>
    );
  }

  const rowClickAction = findRowClickAction(screen.rowActions);
  const wrappedOnRowClick = rowClickAction
    ? (row: ListRowViewModel) =>
        rowClickAction.kind === "drawer"
          ? runDrawerRowAction(rowClickAction, openDrawer, row)
          : runNavigate(rowClickAction, row)
    : onRowClick !== undefined
      ? (row: ListRowViewModel) => onRowClick(row, listScreen.entity)
      : undefined;

  // Same pager-construction as EntityListBody: no Pager UI until the
  // server-provided `total` arrives (guards pagination="pages" without
  // totalCount support).
  const pager = listPager({ usePager, page: listRows.page, limit, urlState });

  return (
    <>
      {refetchErrorBanner}
      <ListGroupPageBridges {...listTable.aggregates.groupPages} />
      <ReferenceFacetBridges specs={facetSpecs} onOptions={handleProjectionFacetOptions} />
      <RenderList
        screen={listScreen}
        entity={entity}
        rows={listRows.rows}
        featureName={schema.featureName}
        searchable={searchable}
        narrowed={isListNarrowed(activeSearch, urlState.filters)}
        {...(screen.description !== undefined && {
          description: effectiveTranslate(screen.description),
        })}
        {...(emptyContent !== undefined && { emptyContent })}
        searchValue={urlState.q}
        onSearchChange={urlState.setQ}
        sort={activeSort}
        onSortChange={urlState.setSort}
        {...(isEmbeddedScreen
          ? { screenPadding: false, chromeless: true }
          : { screenPadding: true })}
        {...(screenFillsHeight(listScreen) && { scrollBody: true })}
        {...(pager !== undefined && { pager })}
        {...(rowActions !== undefined && { rowActions })}
        {...(screen.rowActionMode !== undefined && { rowActionMode: screen.rowActionMode })}
        {...(bulk !== undefined && { bulk })}
        {...(toolbarActions !== undefined && { toolbarActions })}
        {...(translate !== undefined && { translate })}
        {...(wrappedOnRowClick !== undefined && { onRowClick: wrappedOnRowClick })}
        {...(filterFacets.length > 0 && {
          filterFacets,
          onFilterChange: urlState.setFilter,
        })}
        {...(dateRangeFacets.length > 0 && {
          dateRangeFacets,
          onDateRangeChange: handleDateRangeChange,
        })}
        {...listTable.props}
        {...((filterFacets.length > 0 || dateRangeFacets.length > 0) && {
          filterValues: urlState.filters,
          onFilterReset: urlState.clearFilters,
        })}
      />
      <DrawerHost
        schema={schema}
        drawerAction={drawerAction}
        drawerScreen={drawerScreen}
        {...(drawerInitialValues !== undefined && { drawerInitialValues })}
        userRoles={userRoles}
        {...(translate !== undefined && { translate })}
        onClose={closeDrawer}
        onSuccess={() => {
          closeDrawer();
          void refreshRows();
        }}
      />
    </>
  );
}

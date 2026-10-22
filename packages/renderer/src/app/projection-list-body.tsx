import type {
  ProjectionListScreenDefinition,
  RowActionNavigate,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { RenderList } from "../components/render-list.tsx";
import { useOptionalDispatcher } from "../context/dispatcher-context.tsx";
import { useIsEmbeddedScreen } from "../context/embedded-screen-context.tsx";
import { useUserRoles } from "../context/user-roles-context.tsx";
import type { ListRowViewModel, Translate } from "../headless/index.ts";
import { useListUrlState } from "../hooks/use-list-url-state.ts";
import { useQuery } from "../hooks/use-query.ts";
import { useOptionalTimeZone, useTranslation } from "../i18n.tsx";
import {
  type DataTableDateRangeFacet,
  type DataTableFacet,
  usePrimitives,
} from "../primitives.tsx";
import { screenFillsHeight } from "../screen-fills-height.ts";
import { DrawerHost, useDrawerAction } from "./action-form-body.tsx";
import { useAppFeatures } from "./app-features-context.tsx";
import { useClientActionRuntime } from "./client-actions.tsx";
import type { FeatureSchema } from "./feature-schema.ts";
import { isListNarrowed, useListEmptyContent } from "./list-empty-content.ts";
import {
  buildDateRangePayload,
  buildFilterFacets,
  buildFilterPayload,
  clampDateRange,
  mergeReferenceFacetOptions,
  readDateRange,
  resolveDateRangeFacets,
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
import { buildListQueryPayload, type PagedRows, pageSizeOptionsFor } from "./screen-shared.tsx";

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

  // dateRange facets bypass `filters` entirely — their two bounds
  // become the top-level query params the facet declares, resolved from a
  // calendar date to an instant in the viewer's zone.
  const timeZone = useOptionalTimeZone();
  const dateRangeSpecs = useMemo(
    () => resolveDateRangeFacets(screen.facets, effectiveTranslate),
    [screen.facets, effectiveTranslate],
  );
  const dateRangePayload = useMemo(
    () => buildDateRangePayload(dateRangeSpecs, urlState.filters, timeZone),
    [dateRangeSpecs, urlState.filters, timeZone],
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

  const rowsQuery = useQuery<PagedRows>(screen.query, queryPayload, { live: true });

  const filterFacets = useMemo<DataTableFacet[]>(
    () => buildFilterFacets(resolvedFacetSpecs),
    [resolvedFacetSpecs],
  );
  const dateRangeFacets = useMemo<DataTableDateRangeFacet[]>(
    () =>
      dateRangeSpecs.map((spec) => ({
        field: spec.field,
        label: spec.label,
        ...readDateRange(urlState.filters, spec.field),
      })),
    [dateRangeSpecs, urlState.filters],
  );
  const handleDateRangeChange = useCallback(
    (field: string, bound: "from" | "to", value: string) => {
      urlState.setDateRange(
        field,
        clampDateRange(readDateRange(urlState.filters, field), bound, value),
      );
    },
    [urlState.setDateRange, urlState.filters],
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
        refetch: rowsQuery.refetch,
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
      rowsQuery.refetch,
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
        refetch: rowsQuery.refetch,
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
      rowsQuery.refetch,
      openDrawer,
      appFeatures,
      userRoles,
    ],
  );
  const emptyContent = useListEmptyContent(screen.emptyState, effectiveTranslate, {
    nav,
    host,
    dispatcher,
    openDrawer,
    onWriteSuccess: rowsQuery.refetch,
  });

  if (rowsQuery.loading && rowsQuery.data === null) {
    return <QueryLoadingBanner />;
  }
  if (rowsQuery.error && rowsQuery.data === null) {
    return (
      <QueryErrorBanner
        error={rowsQuery.error}
        translate={effectiveTranslate}
        onRetry={rowsQuery.refetch}
      />
    );
  }
  // A failed refetch keeps the last good data on screen.
  const refetchErrorBanner = rowsQuery.error ? (
    <QueryErrorBanner
      error={rowsQuery.error}
      translate={effectiveTranslate}
      onRetry={rowsQuery.refetch}
    />
  ) : null;

  // rowsQuery.data is typed as PagedRows but the query handler is free to
  // return anything at runtime (a bare array silently rendered an empty
  // table instead of surfacing the mismatch), so the shape is checked.
  if (rowsQuery.data !== null && !Array.isArray(rowsQuery.data.rows)) {
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
  const total = rowsQuery.data?.total;
  const pager =
    usePager && total !== undefined
      ? {
          page: urlState.page,
          limit,
          total,
          onPageChange: urlState.setPage,
          pageSizeOptions: pageSizeOptionsFor(limit),
          onPageSizeChange: urlState.setPageSize,
        }
      : undefined;

  return (
    <>
      {refetchErrorBanner}
      <ReferenceFacetBridges specs={facetSpecs} onOptions={handleProjectionFacetOptions} />
      <RenderList
        screen={listScreen}
        entity={entity}
        rows={rowsQuery.data?.rows ?? []}
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
          void rowsQuery.refetch();
        }}
      />
    </>
  );
}

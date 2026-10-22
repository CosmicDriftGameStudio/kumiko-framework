import type {
  EntityDefinition,
  EntityListScreenDefinition,
  RowAction,
  RowActionNavigate,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { evalFieldCondition } from "@cosmicdrift/kumiko-framework/ui-types";
import { resolveActionIcon } from "@cosmicdrift/kumiko-types/action-icon";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RenderList } from "../components/render-list.tsx";
import { useOptionalDispatcher } from "../context/dispatcher-context.tsx";
import { useIsEmbeddedScreen } from "../context/embedded-screen-context.tsx";
import { useUserRoles } from "../context/user-roles-context.tsx";
import { rendererWarn } from "../dev-console.ts";
import type { ListRowViewModel, Translate } from "../headless/index.ts";
import { computeRelatedListSectionViewModel } from "../headless/index.ts";
import { useListUrlState } from "../hooks/use-list-url-state.ts";
import { useQuery } from "../hooks/use-query.ts";
import { useTranslation } from "../i18n.tsx";
import { type DataTableFacet, type DataTableRowAction, usePrimitives } from "../primitives.tsx";
import { screenFillsHeight } from "../screen-fills-height.ts";
import { DrawerHost, useDrawerAction } from "./action-form-body.tsx";
import { useAppFeatures } from "./app-features-context.tsx";
import { useClientActionRuntime } from "./client-actions.tsx";
import { EntityListExpandedRow } from "./entity-list-expanded-row.tsx";
import { resolveEntityFacetSpecs } from "./entity-list-facet-specs.ts";
import { FacetCountBridges, type FacetCountQuery } from "./facet-count-bridge.tsx";
import type { FeatureSchema } from "./feature-schema.ts";
import {
  isDefaultFilterActive,
  isListNarrowed,
  useListEmptyContent,
} from "./list-empty-content.ts";
import {
  buildEntityFilterFacets,
  buildFacetCountRequests,
  buildFilterPayload,
  mergeReferenceFacetOptions,
  normalizeDefaultFilters,
} from "./list-facets.ts";
import { type ScreenTarget, useNav } from "./nav.tsx";
import { QueryErrorBanner, QueryLoadingBanner } from "./query-state-banners.tsx";
import { ReferenceFacetBridges, type ReferenceFacetOption } from "./reference-facet-bridge.tsx";
import { navigateWithReturnTo, useReturnHost } from "./return-to.tsx";
import {
  buildClientActionRowAction,
  buildDefaultEditRowAction,
  buildDrawerRowAction,
  buildProjectionToolbarActions,
  evalRowExtractor,
  findRowClickAction,
  navigateActionSearchParams,
  refetchAfterWrite,
  runDrawerRowAction,
} from "./row-actions.ts";
import { findEditScreenFor } from "./screen-access.ts";
import {
  buildListQueryPayload,
  entityQueryCommand,
  isEntityEditScreenOfEntity,
  type PagedRows,
  pageSizeOptionsFor,
  useNavigateToCreateFor,
} from "./screen-shared.tsx";
import { useScreenListTable } from "./use-screen-list-table.ts";
import { dispatcherErrorText, WriteFailedError } from "./write-failed-error.ts";

export function EntityListScreen({
  schema,
  screen,
  translate,
  onRowClick,
}: {
  readonly schema: FeatureSchema;
  readonly screen: EntityListScreenDefinition;
  readonly translate?: Translate;
  readonly onRowClick?: (row: ListRowViewModel, entityName: string) => void;
}): ReactNode {
  const { Banner, Text } = usePrimitives();
  const entity = schema.entities[screen.entity];
  if (!entity) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-entity-missing">
        Entity <Text variant="code">{screen.entity}</Text> referenced by screen{" "}
        <Text variant="code">{screen.id}</Text> not registered in the schema.
      </Banner>
    );
  }
  // Entity resolved — mount the inner component so useQuery only fires
  // when there's actually something to render. A missing entity is a
  // dev-error state; no point hitting the server for it.
  return (
    <EntityListBody
      schema={schema}
      screen={screen}
      entity={entity}
      {...(translate !== undefined && { translate })}
      {...(onRowClick !== undefined && { onRowClick })}
    />
  );
}

function EntityListBody({
  schema,
  screen,
  entity,
  translate,
  onRowClick,
}: {
  readonly schema: FeatureSchema;
  readonly screen: EntityListScreenDefinition;
  readonly entity: EntityDefinition;
  readonly translate?: Translate;
  readonly onRowClick?: (row: ListRowViewModel, entityName: string) => void;
}): ReactNode {
  const isEmbeddedScreen = useIsEmbeddedScreen();
  const featureName = schema.featureName;
  const resolvedCreate = useNavigateToCreateFor(
    schema,
    screen.entity,
    screen.createScreen,
    screen.createUnavailable,
  );
  const onCreate = screen.allowCreate === false ? undefined : resolvedCreate;
  const queryType = entityQueryCommand(featureName, screen.entity, "list");
  const nav = useNav();
  const host = useReturnHost();
  const userRoles = useUserRoles();
  const appFeatures = useAppFeatures();
  const { drawerAction, drawerScreen, drawerInitialValues, openDrawer, closeDrawer } =
    useDrawerAction(schema);
  const defaultEditScreen = useMemo(
    () => findEditScreenFor(screen.entity, appFeatures, userRoles),
    [appFeatures, screen.entity, userRoles],
  );

  // URL state: sort/dir/q/page live under the screen.id namespace
  // (`/orders?orders.sort=createdAt&orders.dir=desc&orders.q=acme`) so two
  // lists on the same route do not fight over the same query keys. The default
  // sort from the screen definition only wins when the URL has no sort:
  // author default vs user choice.
  const defaultFilters = useMemo(
    () => normalizeDefaultFilters(screen.defaultFilters),
    [screen.defaultFilters],
  );
  const urlState = useListUrlState(screen.id, defaultFilters);
  const effectiveSort = urlState.sort ?? screen.defaultSort ?? null;
  const limit = urlState.pageSize ?? screen.pageSize ?? 50;
  const paginationMode = screen.pagination ?? "pages";
  const usePager = paginationMode === "pages";
  const useInfinite = paginationMode === "infinite";

  // Infinite scroll: local state accumulates rows across several useQuery
  // calls (instead of replacing them like the pager). The cursor changes when
  // the user reaches the bottom sentinel; on a sort/q change everything is
  // reset, since the insert order of the accumulated rows would otherwise be
  // inconsistent with the new sorting.
  const [accumulated, setAccumulated] = useState<readonly Readonly<Record<string, unknown>>[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(true);
  // Ref so the useEffect cleanup does not see stale state.
  const sortQRef = useRef<string>("");
  const sortQKey = `${urlState.q}|${effectiveSort?.field ?? ""}|${effectiveSort?.dir ?? ""}`;
  // Reset rows + cursor on a sort/q change, before the next useQuery so the
  // reload starts with cursor=undefined.
  useEffect(() => {
    if (!useInfinite) return;
    if (sortQRef.current === sortQKey) return;
    sortQRef.current = sortQKey;
    setAccumulated([]);
    setCursor(undefined);
    setHasMore(true);
  }, [useInfinite, sortQKey]);

  // User-selected faceted filters from the URL state -> payload.filters.
  // typeOf reads the field type straight from entity.fields (not gated on
  // filterable, deliberately permissive; see the buildFilterPayload doc).
  const filterPayload = useMemo(
    () =>
      buildFilterPayload(urlState.filters, (field) => {
        // entity.fields is weakly typed at the renderer layer (deserialized from
        // the schema); boundary cast like buildInitialValues.
        const type = propertyOf(entity.fields[field], "type");
        return typeof type === "string" ? type : undefined;
      }),
    [urlState.filters, entity.fields],
  );

  // Entity-only additions (screen.filter, faceted filters) layer on top of
  // the shared buildListQueryPayload — projectionList has neither.
  const queryPayload = useMemo(() => {
    const payload = buildListQueryPayload({
      limit,
      search: urlState.q,
      sort: effectiveSort,
      usePager,
      page: urlState.page,
      useInfinite,
      cursor,
    });
    // Screen filter (tier 2.7c), declared by the author on the schema and
    // independent of the user's q search. Several buckets of the same entity
    // ("Upcoming" / "Active" / "Past") use different filters with the same
    // query handler.
    if (screen.filter !== undefined) {
      payload["filter"] = screen.filter;
    }
    if (filterPayload.length > 0) {
      payload["filters"] = filterPayload;
    }
    return payload;
  }, [
    limit,
    urlState.q,
    effectiveSort,
    screen.filter,
    filterPayload,
    usePager,
    urlState.page,
    useInfinite,
    cursor,
  ]);

  const rowsQuery = useQuery<PagedRows>(queryType, queryPayload, { live: true });

  // Facet counts come from their own queries, which a write leaves untouched.
  const [facetCountRefreshNonce, setFacetCountRefreshNonce] = useState(0);
  const refreshFacetCounts = useCallback(() => setFacetCountRefreshNonce((n) => n + 1), []);

  const refreshRowsAfterWrite = useCallback(async () => {
    refreshFacetCounts();
    if (useInfinite) {
      setAccumulated([]);
      setCursor(undefined);
      setHasMore(true);
      return;
    }
    await refetchAfterWrite(rowsQuery.refetch);
  }, [useInfinite, rowsQuery.refetch, refreshFacetCounts]);

  // Infinite scroll: on every successful result append the rows and derive
  // hasMore from nextCursor. Live updates (postgres NOTIFY) and initial loads
  // both pass through here; the useEffect dependency array pins the dedup to
  // the last processed data pointer.
  const lastDataRef = useRef<PagedRows | null>(null);
  useEffect(() => {
    if (!useInfinite) return;
    const data = rowsQuery.data;
    if (data === null) return;
    if (data === lastDataRef.current) return;
    lastDataRef.current = data;
    setAccumulated((prev) => {
      // When cursor is undefined this is the first page after a sort/q change:
      // replace everything instead of appending. Otherwise dedupe on id in case
      // live updates bring in an entry on the next page that was already appended.
      if (cursor === undefined) return data.rows;
      const seen = new Set<unknown>(prev.map((r) => r["id"]));
      const fresh = data.rows.filter((r) => !seen.has(r["id"]));
      return [...prev, ...fresh];
    });
    setHasMore(data.nextCursor !== null);
  }, [rowsQuery.data, useInfinite, cursor]);

  const loadMore = useCallback(() => {
    if (!useInfinite) return;
    if (rowsQuery.loading) return;
    const data = rowsQuery.data;
    if (data?.nextCursor === undefined || data.nextCursor === null) return;
    setCursor(data.nextCursor);
  }, [useInfinite, rowsQuery.loading, rowsQuery.data]);

  // RowActions: schema form (handler QN + i18n key) -> resolved form
  // (dispatcher call + translated strings). dispatcher.write knows the user
  // internally (JWT cookie). The schema may contain raw strings as well as
  // i18n keys; translate() returns the key when the bundle does not know it
  // (convention everywhere in the renderer).
  // Hook order: ALL hooks before the early return for loading/error,
  // otherwise the hook slots collide between renders.
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;

  // Faceted filter: one dropdown per filterable select/boolean/reference field.
  // Labels + select option labels use the same i18n convention as the column
  // headers (fieldLabelKey / :option:<value>); reference fields load their
  // options asynchronously through ReferenceFacetBridges.
  const entityFacetSpecs = useMemo(
    () => resolveEntityFacetSpecs(entity.fields, featureName, screen.entity, effectiveTranslate),
    [entity.fields, featureName, screen.entity, effectiveTranslate],
  );
  const facetFilterFields = useMemo(
    () => entityFacetSpecs.map((spec) => spec.field),
    [entityFacetSpecs],
  );
  const listTable = useScreenListTable({
    screen,
    featureName: featureName,
    payload: queryPayload,
    filterFields: facetFilterFields,
  });
  const [entityReferenceFacetOptions, setEntityReferenceFacetOptions] = useState<
    Record<string, readonly ReferenceFacetOption[]>
  >({});
  const handleEntityFacetOptions = useCallback(
    (field: string, options: readonly ReferenceFacetOption[]) =>
      setEntityReferenceFacetOptions((prev) =>
        prev[field] === options ? prev : { ...prev, [field]: options },
      ),
    [],
  );
  const [facetCounts, setFacetCounts] = useState<Record<string, number>>({});
  const handleFacetCount = useCallback(
    (key: string, count: number) =>
      setFacetCounts((prev) => (prev[key] === count ? prev : { ...prev, [key]: count })),
    [],
  );
  const filterFacets = useMemo<DataTableFacet[]>(
    () =>
      buildEntityFilterFacets(
        mergeReferenceFacetOptions(entityFacetSpecs, entityReferenceFacetOptions),
        screen.facets,
        effectiveTranslate,
        facetCounts,
      ),
    [entityFacetSpecs, entityReferenceFacetOptions, screen.facets, effectiveTranslate, facetCounts],
  );
  const facetCountQueries = useMemo<FacetCountQuery[]>(
    () =>
      buildFacetCountRequests(entityFacetSpecs, screen.facets, effectiveTranslate).map(
        (request) => {
          const filters = buildFilterPayload(
            { ...urlState.filters, [request.field]: request.values },
            (field) => entity.fields[field]?.type,
          );
          return {
            key: request.key,
            payload: {
              limit: 1,
              totalCount: true,
              ...(urlState.q !== "" && { search: urlState.q }),
              ...(screen.filter !== undefined && { filter: screen.filter }),
              ...(filters.length > 0 && { filters }),
            },
          };
        },
      ),
    [
      entityFacetSpecs,
      screen.facets,
      screen.filter,
      effectiveTranslate,
      urlState.filters,
      urlState.q,
      entity.fields,
    ],
  );

  // Soft dispatcher: in tests that mount without a DispatcherProvider,
  // rowActions stays undefined instead of crashing. Real apps have the
  // provider via createKumikoApp; if it is missing it is most likely a setup
  // error, so warn once so the author finds it (otherwise the action column
  // silently renders nothing and the "why are my buttons gone?" debugging is
  // expensive).
  const dispatcher = useOptionalDispatcher();
  const clientActions = useClientActionRuntime();
  const hasRowActions = screen.rowActions !== undefined && screen.rowActions.length > 0;
  useEffect(() => {
    if (hasRowActions && dispatcher === undefined) {
      rendererWarn(
        `[kumiko] Screen "${screen.id}" deklariert rowActions, aber kein <DispatcherProvider> ist mounted — die Action-Spalte wird nicht gerendert. createKumikoApp() wired den Provider automatisch.`,
      );
    }
  }, [hasRowActions, dispatcher, screen.id]);
  // Discriminated union: writeHandler (default) dispatches a server
  // handler, navigate calls nav.navigate(), possibly with URL search params
  // from params(row). nav lives further down in the EntityListBody scope.
  // Shared navigate execution: both the "..." action menu (rowActions) and the
  // row body click (rowClick) go through it, one path so the two cannot
  // drift apart.
  const runNavigate = useCallback(
    (action: RowActionNavigate, row: ListRowViewModel) => {
      if (action.entity !== undefined) {
        // Entity targets only resolve in the NavApi implementation
        // against ALL features (resolveTarget in renderer/web/nav.tsx); this
        // package only knows `schema` (the one calling feature) and cannot look up
        // detailFor across features itself.
        const explicit =
          action.entityId !== undefined ? String(row.values[action.entityId] ?? "") : undefined;
        // Same-entity only — cross-entity targets must declare entityId (boot-validator).
        const fallback =
          action.entity === screen.entity ? String(row.values["id"] ?? "") : undefined;
        const id = explicit ?? fallback ?? "";
        if (id === "") return;
        const params = navigateActionSearchParams(action, row.values);
        navigateWithReturnTo(nav, { entity: action.entity, id }, host, params);
      } else if (action.screen !== undefined) {
        // Default entityId for entityEdit targets: row["id"] when no explicit
        // entityId field name is set. Only for targets of the SAME entity, otherwise
        // a cross-entity edit screen would get the wrong row.id injected.
        const targetIsEntityEdit = isEntityEditScreenOfEntity(
          screen.entity,
          action.screen,
          schema,
          appFeatures,
        );
        const explicit =
          action.entityId !== undefined ? String(row.values[action.entityId] ?? "") : undefined;
        const fallback = targetIsEntityEdit ? String(row.values["id"] ?? "") : undefined;
        const entityId = explicit ?? fallback;
        const target: ScreenTarget = {
          screenId: action.screen,
          ...(entityId !== undefined && entityId !== "" && { entityId }),
        };
        // setSearchParams takes string|null, so complex values become strings (the
        // reader only knows strings via the URL). Known edge: if the action targets
        // the CURRENT pathname, the params merge onto the old ?-string (practically
        // unreachable for row actions, the path differs).
        const params = navigateActionSearchParams(action, row.values);
        navigateWithReturnTo(nav, target, host, params);
      }
    },
    [nav, schema, appFeatures, screen.entity, host],
  );

  const rowActions = useMemo(() => {
    const declared = screen.rowActions ?? [];
    // Prepended unless a declared rowAction already has id "edit" — declared wins.
    const declaredHasEdit = declared.some((a) => a.id === "edit");
    const defaultEditRowAction = declaredHasEdit
      ? undefined
      : buildDefaultEditRowAction(defaultEditScreen);
    const effectiveActions: readonly RowAction[] =
      defaultEditRowAction !== undefined ? [defaultEditRowAction, ...declared] : declared;
    if (effectiveActions.length === 0) return undefined;
    return effectiveActions
      .map((action: RowAction): DataTableRowAction | null => {
        // The navigate variant needs no dispatcher; nav is always present
        // (provider from createKumikoApp).
        if (action.kind === "navigate") {
          const navigateAction = action;
          const actionVisible = action.visible;
          const actionIcon = resolveActionIcon(action.id, action.icon);
          return {
            id: action.id,
            label: effectiveTranslate(action.label),
            ...(action.style !== undefined && { style: action.style }),
            ...(action.display !== undefined && { display: action.display }),
            confirmRequired: false,
            ...(navigateAction.rowClick === true && { rowClick: true }),
            ...(actionIcon !== undefined && { icon: actionIcon }),
            onTrigger: (row: ListRowViewModel) => runNavigate(navigateAction, row),
            ...(actionVisible !== undefined && {
              isVisible: (row: ListRowViewModel) => evalFieldCondition(actionVisible, row.values),
            }),
          };
        }
        if (action.kind === "drawer") {
          return buildDrawerRowAction(action, effectiveTranslate, openDrawer);
        }
        if (action.kind === "clientAction") {
          return buildClientActionRowAction(
            action,
            effectiveTranslate,
            clientActions,
            refreshRowsAfterWrite,
          );
        }
        if (dispatcher === undefined) return null;
        const writeAction = action;
        const writeActionVisible = writeAction.visible;
        return {
          id: writeAction.id,
          label: effectiveTranslate(writeAction.label),
          style: writeAction.style,
          icon: resolveActionIcon(writeAction.id, writeAction.icon),
          confirm:
            writeAction.confirm !== undefined ? effectiveTranslate(writeAction.confirm) : undefined,
          confirmLabel:
            writeAction.confirmLabel !== undefined
              ? effectiveTranslate(writeAction.confirmLabel)
              : undefined,
          onTrigger: async (row: ListRowViewModel) => {
            const buildPayload = writeAction.payload;
            const payload =
              buildPayload !== undefined
                ? evalRowExtractor(buildPayload, row.values)
                : { id: row.values["id"] };
            const result = await dispatcher.write(writeAction.handler, payload);
            // write() does not throw: a failure result MUST become an error here,
            // otherwise the confirm dialog closes silently and the user sees "nothing
            // happened" (prod bug 2026-06-07).
            if (!result.isSuccess) {
              throw new WriteFailedError(
                result.error,
                dispatcherErrorText(result.error, effectiveTranslate),
              );
            }
            await refreshRowsAfterWrite();
          },
          isVisible:
            writeActionVisible !== undefined
              ? (row: ListRowViewModel) => evalFieldCondition(writeActionVisible, row.values)
              : undefined,
        };
      })
      .filter((a: DataTableRowAction | null): a is DataTableRowAction => a !== null);
  }, [
    screen.rowActions,
    defaultEditScreen,
    effectiveTranslate,
    dispatcher,
    clientActions,
    runNavigate,
    refreshRowsAfterWrite,
    openDrawer,
  ]);

  // ToolbarActions: Schema → Resolved-Form (analog rowActions), shared with
  // projectionList and relatedList sections via buildProjectionToolbarActions.
  const toolbarActions = useMemo(
    () =>
      buildProjectionToolbarActions({
        toolbarActions: screen.toolbarActions,
        translate: effectiveTranslate,
        dispatcher,
        nav,
        refetch: refreshRowsAfterWrite,
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
      refreshRowsAfterWrite,
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
    onWriteSuccess: refreshRowsAfterWrite,
  });

  // Expandable rows: open state is keyed by row id, so it survives refetch,
  // sort and page changes. Several rows can be open at once.
  const expandableRow = screen.expandableRow;
  const expandableSection = useMemo(
    () =>
      expandableRow !== undefined
        ? computeRelatedListSectionViewModel(expandableRow, effectiveTranslate)
        : undefined,
    [expandableRow, effectiveTranslate],
  );
  const [expandedRowIds, setExpandedRowIds] = useState<ReadonlySet<string>>(() => new Set());
  const toggleRowExpanded = useCallback((rowId: string) => {
    setExpandedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }, []);
  // Bumped after a write that ran outside the sub-list (drawer submit,
  // title-row action) so open sub-lists remount and reload.
  const [expansionNonce, setExpansionNonce] = useState(0);
  const invalidateExpansions = useCallback(() => setExpansionNonce((n) => n + 1), []);
  const renderExpandedRow = useCallback(
    (row: ListRowViewModel): ReactNode =>
      expandableSection === undefined ? null : (
        <EntityListExpandedRow
          section={expandableSection}
          row={row}
          featureName={featureName}
          {...(translate !== undefined && { translate })}
          expansionNonce={expansionNonce}
          openDrawer={openDrawer}
          onAfterWrite={refreshRowsAfterWrite}
          onSubListInvalidated={invalidateExpansions}
        />
      ),
    [
      expandableSection,
      featureName,
      translate,
      expansionNonce,
      openDrawer,
      refreshRowsAfterWrite,
      invalidateExpansions,
    ],
  );

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

  // RenderList's onRowClick is a 1-arg callback; KumikoScreen's
  // 2-arg shape (row, entityName) is the public surface — thread the
  // screen's entity through here so callers don't have to re-derive
  // it.
  // Row body click: a navigate rowAction explicitly marked as rowClick wins
  // (declared author intent "clicking the row does X"). Without the flag the
  // path is unchanged: create-app's entityEdit default or an onRowClick set
  // by the app author.
  const rowClickAction = findRowClickAction(screen.rowActions);
  const wrappedOnRowClick = rowClickAction
    ? (row: ListRowViewModel) =>
        rowClickAction.kind === "drawer"
          ? runDrawerRowAction(rowClickAction, openDrawer, row)
          : runNavigate(rowClickAction, row)
    : onRowClick !== undefined
      ? (row: ListRowViewModel) => onRowClick(row, screen.entity)
      : undefined;

  // Searchable default: explicit author choice wins, otherwise auto-on when
  // the entity has searchable fields (dead toolbar slot otherwise — the
  // server search index has nothing to filter). Gated on
  // schema.searchAdapterMissing !== true regardless of source (explicit or
  // auto) — a search bar the server can't serve would 422 at request-time;
  // matches the boot-time check in api/server.ts.
  const searchable =
    schema.searchAdapterMissing !== true &&
    (screen.searchable ??
      Object.values(entity.fields).some((f) => "searchable" in f && f.searchable === true));

  // Assemble pager props only for pagination="pages". The server total
  // arrives async; until it is there RenderList renders the table without a
  // pager (the pager has its own total>0 guard).
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

  // In infinite mode rows come from accumulated (collected across several
  // useQuery calls), with pages/false from the current result.
  const renderRows = useInfinite ? accumulated : (rowsQuery.data?.rows ?? []);

  return (
    <>
      {refetchErrorBanner}
      <ReferenceFacetBridges specs={entityFacetSpecs} onOptions={handleEntityFacetOptions} />
      <FacetCountBridges
        queryType={queryType}
        queries={facetCountQueries}
        onCount={handleFacetCount}
        refreshNonce={facetCountRefreshNonce}
      />
      <RenderList
        screen={screen}
        entity={entity}
        rows={renderRows}
        featureName={featureName}
        searchable={searchable}
        narrowed={isListNarrowed(urlState.q, urlState.filters, defaultFilters)}
        defaultFilterActive={isDefaultFilterActive(urlState.q, urlState.filters, defaultFilters)}
        {...(screen.description !== undefined && {
          description: effectiveTranslate(screen.description),
        })}
        {...(emptyContent !== undefined && { emptyContent })}
        searchValue={urlState.q}
        onSearchChange={urlState.setQ}
        sort={effectiveSort}
        onSortChange={urlState.setSort}
        {...(isEmbeddedScreen
          ? { screenPadding: false, chromeless: true }
          : { screenPadding: true })}
        {...(screenFillsHeight(screen) && { scrollBody: true })}
        {...(pager !== undefined && { pager })}
        {...(rowActions !== undefined && { rowActions })}
        {...(screen.rowActionMode !== undefined && { rowActionMode: screen.rowActionMode })}
        {...(toolbarActions !== undefined && toolbarActions.length > 0 && { toolbarActions })}
        {...(useInfinite && {
          onReachEnd: loadMore,
          loadingMore: rowsQuery.loading,
          hasMore,
        })}
        {...(onCreate !== undefined && { onCreate })}
        {...(translate !== undefined && { translate })}
        {...(wrappedOnRowClick !== undefined && { onRowClick: wrappedOnRowClick })}
        {...(filterFacets.length > 0 && {
          filterFacets,
          filterValues: urlState.filters,
          onFilterChange: urlState.setFilter,
          onFilterReset: urlState.clearFilters,
        })}
        {...listTable}
        {...(expandableSection !== undefined && {
          expandedRowIds,
          onToggleRowExpanded: toggleRowExpanded,
          renderExpandedRow,
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
          invalidateExpansions();
          refreshFacetCounts();
          void rowsQuery.refetch();
        }}
      />
    </>
  );
}

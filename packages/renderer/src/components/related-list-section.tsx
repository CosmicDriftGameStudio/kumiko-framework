import type {
  EntityDefinition,
  EntityListScreenDefinition,
  RelatedListGroupBy,
  RelatedListRowTone,
  RowActionDrawer,
  RowActionNavigate,
} from "@cosmicdrift/kumiko-framework/ui-types";
import {
  evalFieldCondition,
  normalizeListColumn,
  parseRefTarget,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type {
  EditRelatedListSectionViewModel,
  ListRowViewModel,
  Translate,
} from "@cosmicdrift/kumiko-headless";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { useAppFeatures } from "../app/app-features-context.js";
import {
  buildFilterFacets,
  buildFilterPayload,
  mergeReferenceFacetOptions,
  resolveProjectionFacetSpecs,
} from "../app/list-facets.js";
import { useNav } from "../app/nav.js";
import { ReferenceFacetBridges, type ReferenceFacetOption } from "../app/reference-facet-bridge.js";
import { navigateWithReturnTo, useReturnHost } from "../app/return-to.js";
import {
  buildDefaultEditRowAction,
  buildProjectionRowActions,
  buildProjectionToolbarActions,
  buildRecordActions,
  runProjectionRowNavigate,
} from "../app/row-actions.js";
import { findEditScreenFor } from "../app/screen-access.js";
import { dispatcherErrorText } from "../app/write-failed-error.js";
import { useOptionalDispatcher } from "../context/dispatcher-context.js";
import { useUserRoles } from "../context/user-roles-context.js";
import type { ListSort } from "../hooks/use-list-url-state.js";
import { useQuery } from "../hooks/use-query.js";
import { useOptionalLocale, useTranslation } from "../i18n.js";
import { PageHeaderSlotAvailableProvider } from "../page-header-slot.js";
import {
  type DataTableFacet,
  type DataTableProps,
  type DataTableRowGrouping,
  usePrimitives,
} from "../primitives.js";
import { sortByAccessor } from "../sort-by-accessor.js";
import { RenderEditActionButton } from "./render-edit-action-button.js";
import { RenderList } from "./render-list.js";

const RELATED_LIST_PSEUDO_ENTITY = "__related-list__";

// Same paged envelope as ProjectionListBody's PagedRows (kumiko-screen.tsx) —
// duplicated locally because that type isn't exported (projectionList and
// relatedList are independent query call-sites, not a shared abstraction).
type PagedRows = {
  readonly rows: Readonly<Record<string, unknown>>[];
  readonly nextCursor: string | null;
  readonly total?: number;
};

// Minimal EntityDefinition from the section's own columns — same shape as
// projection-list-shim's synthesizeProjectionEntity, but sortable is read
// per-column (ListColumnSpec.sortable) instead of screen-wide, since a
// relatedList section has no single Zod schema to derive it from. With a
// declared `entity`, a column naming one of its fields takes that field's
// definition, so RenderList formats it exactly like an entityList column;
// only `sortable` stays per-column because the sort runs locally.
function synthesizeRelatedListEntity(
  columns: EditRelatedListSectionViewModel["columns"],
  sourceEntity: EntityDefinition | undefined,
): EntityDefinition {
  const fields: Record<string, unknown> = {};
  for (const col of columns) {
    const normalized = normalizeListColumn(col);
    const sortable = normalized.sortable === true;
    const sourceField = sourceEntity?.fields[normalized.field];
    fields[normalized.field] =
      sourceField !== undefined
        ? { ...sourceField, sortable }
        : { type: normalized.valueType ?? "text", sortable };
  }
  return { ...sourceEntity, fields } as unknown as EntityDefinition;
}

// Mirrors row-actions.ts's own warnDrawerActionDropped (module-private
// there, so not reusable directly) — a drawer-kind emptyState.action with no
// onOpenDrawer wired is dropped (not rendered) with a dev warning, same as a
// drawer-kind rowAction/toolbarAction without one.
function warnRelatedListEmptyStateDrawerDropped(actionId: string): void {
  // biome-ignore lint/suspicious/noConsole: dev-time warning, same pattern as row-actions.ts
  console.warn(
    `[kumiko] relatedList emptyState.action "${actionId}" is kind: "drawer" but no onOpenDrawer was supplied — dropped.`,
  );
}

function buildRowGrouping(
  groupBy: RelatedListGroupBy,
  translate: Translate,
  locale: string,
): DataTableRowGrouping {
  return {
    keyOf: (row) => String(row.values[groupBy.field] ?? ""),
    startsCollapsed: (key) =>
      groupBy.collapsedWhen !== undefined && key === String(groupBy.collapsedWhen),
    headerLabel: (key, rows) => {
      const dates =
        groupBy.dateField === undefined
          ? []
          : rows
              .map((row) => String(row.values[groupBy.dateField ?? ""] ?? ""))
              .filter((value) => value !== "")
              .sort();
      const latest = dates[dates.length - 1];
      return translate(groupBy.labels?.[key] ?? groupBy.label, {
        count: rows.length,
        value: key,
        lastDate:
          latest === undefined
            ? ""
            : new Date(latest).toLocaleDateString(locale, {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                timeZone: "UTC",
              }),
      });
    },
  };
}

function buildRowTone(rule: RelatedListRowTone | undefined): DataTableProps["rowTone"] {
  if (rule === undefined) return undefined;
  return (row) => (evalFieldCondition(rule, { ...row.values }) ? rule.tone : undefined);
}

export function RelatedListSection({
  section,
  parentId,
  record,
  featureName,
  translate,
  hideTitle,
  grow,
  onOpenDrawer,
  actions,
  embedded,
  onAfterWrite,
}: {
  readonly section: EditRelatedListSectionViewModel;
  readonly parentId: string;
  /** The enclosing projectionDetail's own record (the "Akte") — evaluates
   *  toolbarActions' `visible`/`params` (RelatedListToolbarAction), the same
   *  record header actions already use. */
  readonly record: Readonly<Record<string, unknown>>;
  readonly featureName: string;
  readonly translate?: Translate;
  readonly hideTitle?: boolean;
  /** Under a fixed-height screen the tab panel chain stretches so the count footer sits at the bottom. */
  readonly grow?: boolean;
  /** Opens a drawer-kind rowAction (fw#2710). Supplied by the parent
   *  (ProjectionDetailBody), which owns schema + the actual Drawer render —
   *  this component only ever invokes the callback. */
  readonly onOpenDrawer?: (
    action: RowActionDrawer,
    initialValues: Readonly<Record<string, unknown>> | undefined,
  ) => void;
  /** section.actions, already resolved into buttons by the caller —
   *  rendered in the Section's title row. Only reachable in the standalone
   *  (non-`hideTitle`) branch below — `hideTitle` uses `FillContainer`, which
   *  has no title row to render actions into (see the comment on that branch). */
  readonly actions?: ReactNode;
  /** Mounted inside a host row (entityList `expandableRow`): unframed, in
   *  document flow (no Section card, no scrollBody), with its own title row
   *  carrying `actions`. */
  readonly embedded?: boolean;
  /** Runs after this section's own refetch once a write action (row action,
   *  toolbar action, emptyState action) succeeded — lets a host reload data
   *  the write also changed. */
  readonly onAfterWrite?: () => void | Promise<void>;
}): ReactNode {
  const { Banner, Section, Card, FillContainer, Text, Button, Dialog } = usePrimitives();
  const [emptyStateActionError, setEmptyStateActionError] = useState<string | null>(null);
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  const locale = useOptionalLocale();
  const rowGrouping = useMemo(
    () =>
      section.groupBy === undefined
        ? undefined
        : buildRowGrouping(section.groupBy, effectiveTranslate, locale ?? "en"),
    [section.groupBy, effectiveTranslate, locale],
  );
  const rowTone = useMemo(() => buildRowTone(section.rowTone), [section.rowTone]);
  const nav = useNav();
  const host = useReturnHost();
  const dispatcher = useOptionalDispatcher();
  const appFeatures = useAppFeatures();
  const userRoles = useUserRoles();
  const defaultEditScreen = useMemo(() => {
    const targetEntity = section.rowClick?.entity;
    if (targetEntity === undefined) return undefined;
    return findEditScreenFor(targetEntity, appFeatures, userRoles);
  }, [appFeatures, section.rowClick, userRoles]);
  const defaultEditRowAction = useMemo(
    () => buildDefaultEditRowAction(defaultEditScreen, section.rowClick?.idColumn ?? "id"),
    [defaultEditScreen, section.rowClick],
  );

  // RenderList derives header and option-label keys from (featureName,
  // screen.entity), so a declared entity also supplies both.
  const sourceTarget = useMemo(
    () => (section.entity !== undefined ? parseRefTarget(section.entity, featureName) : undefined),
    [section.entity, featureName],
  );
  const sourceEntity =
    sourceTarget !== undefined
      ? appFeatures.find((f) => f.featureName === sourceTarget.featureName)?.entities[
          sourceTarget.entityName
        ]
      : undefined;
  const listFeatureName = sourceEntity !== undefined ? sourceTarget?.featureName : undefined;
  const listEntityName = sourceEntity !== undefined ? sourceTarget?.entityName : undefined;
  const entity = useMemo(
    () => synthesizeRelatedListEntity(section.columns, sourceEntity),
    [section.columns, sourceEntity],
  );
  const listScreen = useMemo(
    (): EntityListScreenDefinition => ({
      // Empty id → RenderList's own toolbarTitle resolves to "" (its
      // `screen:${id}.title` lookup misses and falls back to `id`) — this
      // component renders the visible heading itself via `Section` below,
      // so RenderList's toolbar carries none.
      id: "",
      type: "entityList",
      entity: listEntityName ?? RELATED_LIST_PSEUDO_ENTITY,
      columns: section.columns,
    }),
    [section.columns, listEntityName],
  );

  // Local state, not URL state: a section `id` is optional, so there is no
  // stable URL key to namespace against — the section's sort is local for the
  // same reason. Consequence: search/filters reset on reload.
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Readonly<Record<string, readonly string[]>>>({});

  const facetSpecs = useMemo(
    () => resolveProjectionFacetSpecs(section.facets, effectiveTranslate, featureName),
    [section.facets, effectiveTranslate, featureName],
  );
  const [referenceFacetOptions, setReferenceFacetOptions] = useState<
    Record<string, readonly ReferenceFacetOption[]>
  >({});
  const handleFacetOptions = useCallback(
    (field: string, options: readonly ReferenceFacetOption[]) =>
      setReferenceFacetOptions((prev) =>
        prev[field] === options ? prev : { ...prev, [field]: options },
      ),
    [],
  );
  const resolvedFacetSpecs = useMemo(
    () => mergeReferenceFacetOptions(facetSpecs, referenceFacetOptions),
    [facetSpecs, referenceFacetOptions],
  );
  const filterPayload = useMemo(
    () =>
      buildFilterPayload(
        filters,
        (field) => resolvedFacetSpecs.find((spec) => spec.field === field)?.type,
      ),
    [filters, resolvedFacetSpecs],
  );
  const filterFacets = useMemo<DataTableFacet[]>(
    () => buildFilterFacets(resolvedFacetSpecs),
    [resolvedFacetSpecs],
  );

  const payload = useMemo(
    () => ({
      // `parentFilter` sends the parent id as a server-side `filter` clause
      // instead of a bespoke top-level key — the generic `<entity>:list`
      // query understands `filter`, not an arbitrary `parentParam` key. Kept
      // separate from `filterPayload` (user facets) below so a facet
      // selection can never clear or overwrite it.
      ...(section.parentFilter !== undefined
        ? { filter: { field: section.parentFilter.field, op: "eq" as const, value: parentId } }
        : { [section.parentParam ?? "id"]: parentId }),
      ...(section.pageSize !== undefined && { limit: section.pageSize }),
      // Gated on the declared capability, not just on state carrying a value —
      // same rule as ProjectionListBody: a param the bound query's Zod schema
      // doesn't accept would 422 the whole section.
      ...(section.searchable === true && search !== "" && { search }),
      ...(section.facets !== undefined && filterPayload.length > 0 && { filters: filterPayload }),
    }),
    [
      section.parentFilter,
      section.parentParam,
      section.pageSize,
      section.searchable,
      section.facets,
      parentId,
      search,
      filterPayload,
    ],
  );

  const rowsQuery = useQuery<PagedRows>(section.query, payload);
  const ownRefetch = rowsQuery.refetch;
  const refetchSelfAndHost = useCallback(async (): Promise<void> => {
    await ownRefetch();
    await onAfterWrite?.();
  }, [ownRefetch, onAfterWrite]);

  const onFilterChange = useCallback(
    (field: string, values: readonly string[]) =>
      setFilters((prev) => ({ ...prev, [field]: values })),
    [],
  );
  const onFilterReset = useCallback(() => setFilters({}), []);

  // Sorted client-side over the already-loaded rows only. The section has no
  // pager (one-shot fetch); when that fetch is truncated (`nextCursor` set) the
  // truncation banner below tells the user the sorted set is partial.
  const [sort, setSort] = useState<ListSort | null>(section.defaultSort ?? null);
  const sortAccessors = useMemo(() => {
    const accessors: Record<
      string,
      (row: Readonly<Record<string, unknown>>) => string | number | null
    > = {};
    for (const col of section.columns) {
      const field = normalizeListColumn(col).field;
      accessors[field] = (row) => {
        const value = row[field];
        if (value === null || value === undefined) return null;
        return typeof value === "number" ? value : String(value);
      };
    }
    return accessors;
  }, [section.columns]);
  const sortedRows = useMemo(
    () => sortByAccessor(rowsQuery.data?.rows ?? [], sort, sortAccessors, locale),
    [rowsQuery.data, sort, sortAccessors, locale],
  );

  const rowClick = section.rowClick;
  // A row-body click target comes from EITHER the legacy `rowClick` field OR
  // a `rowActions` entry marked rowClick:true — the boot-validator rejects
  // both being set, so this order is just a fallback, not a precedence rule.
  const rowClickAction = section.rowActions?.find(
    (a): a is RowActionNavigate => a.kind === "navigate" && a.rowClick === true,
  );
  const onRowClick =
    rowClick !== undefined
      ? (row: ListRowViewModel) => {
          const id = String(row.values[rowClick.idColumn ?? "id"] ?? "");
          if (id === "") return;
          navigateWithReturnTo(nav, { entity: rowClick.entity, id }, host);
        }
      : rowClickAction !== undefined
        ? (row: ListRowViewModel) => runProjectionRowNavigate(nav, rowClickAction, row, host)
        : undefined;

  // Same execution path as projectionList's rowActions (kumiko-screen.tsx) —
  // a relatedList row has the identical "no guaranteed id field" shape a
  // query-projection row has, so navigate/writeHandler dispatch is shared
  // rather than a second implementation (fw editable-detail-screens).
  const rowActions = useMemo(
    () =>
      buildProjectionRowActions({
        rowActions: section.rowActions,
        translate: effectiveTranslate,
        dispatcher,
        nav,
        refetch: refetchSelfAndHost,
        openDrawer: onOpenDrawer,
        defaultEditRowAction,
        host,
      }),
    [
      section.rowActions,
      effectiveTranslate,
      dispatcher,
      nav,
      refetchSelfAndHost,
      onOpenDrawer,
      defaultEditRowAction,
      host,
    ],
  );

  // Toolbar actions (e.g. "+ Create" above the tab table) — same schema
  // and dispatch semantics as entityList/projectionList.
  const toolbarActionButtons = useMemo(
    () =>
      buildProjectionToolbarActions({
        toolbarActions: section.toolbarActions,
        translate: effectiveTranslate,
        dispatcher,
        nav,
        refetch: refetchSelfAndHost,
        navigatePrefill:
          section.parentFilter !== undefined
            ? { [section.parentFilter.field]: parentId }
            : { [section.parentParam ?? "id"]: parentId },
        record,
        host,
        ...(onOpenDrawer !== undefined && {
          openDrawer: (action) => onOpenDrawer(action, undefined),
        }),
      }),
    [
      section.toolbarActions,
      section.parentParam,
      section.parentFilter,
      parentId,
      record,
      effectiveTranslate,
      dispatcher,
      nav,
      host,
      refetchSelfAndHost,
      onOpenDrawer,
    ],
  );

  // emptyState.action is a RowAction — the same record-bound action shape
  // (and evalRowExtractor payload/params evaluation) screen-level and
  // section-level actions already use via buildRecordActions, NOT the
  // toolbar-action builder (whose `payload` is a literal Record, not a
  // RowFieldExtractor — casting a RowAction into it would silently skip the
  // declared `pick`/`map` evaluation). "Row" here is the parent record: a
  // relatedList's emptyState has no row of its own.
  const emptyStateActionButton = useMemo(() => {
    const action = section.emptyState?.action;
    if (action === undefined) return undefined;
    if (action.kind === "drawer" && onOpenDrawer === undefined) {
      warnRelatedListEmptyStateDrawerDropped(action.id);
      return undefined;
    }
    return buildRecordActions({
      actions: [action],
      record,
      translate: effectiveTranslate,
      nav,
      host,
      dispatcher,
      openDrawer: onOpenDrawer ?? (() => {}),
      onWriteSuccess: refetchSelfAndHost,
    })?.[0];
  }, [
    section.emptyState,
    record,
    effectiveTranslate,
    nav,
    host,
    dispatcher,
    onOpenDrawer,
    refetchSelfAndHost,
  ]);
  const emptyStateContent =
    section.emptyState !== undefined ? (
      <>
        <Text>{section.emptyState.title}</Text>
        {section.emptyState.description !== undefined && (
          <Text variant="small">{section.emptyState.description}</Text>
        )}
        {emptyStateActionButton !== undefined && (
          <RenderEditActionButton
            action={emptyStateActionButton}
            Button={Button}
            Dialog={Dialog}
            onError={setEmptyStateActionError}
          />
        )}
      </>
    ) : undefined;

  // A truncated fetch means `sortedRows` is a sort of a partial set, not of
  // the full related-row set — the client-side sort above (or even plain
  // unsorted display) would silently claim "these are the top N" when they
  // are really just "the first N in the server's own order" (fw#2722 review).
  // `nextCursor` is exactly how the paged envelope marks that: non-null means
  // more rows exist server-side beyond what was fetched.
  // A handler that omits `nextCursor` (or reports a `total` the fetched rows
  // already cover) has no further rows — only a real cursor marks truncation.
  const truncated =
    rowsQuery.data !== null &&
    typeof rowsQuery.data.nextCursor === "string" &&
    (rowsQuery.data.total === undefined || rowsQuery.data.total > rowsQuery.data.rows.length);

  const content =
    rowsQuery.loading && rowsQuery.data === null ? (
      <Banner padded variant="loading" testId="related-list-loading">
        Loading…
      </Banner>
    ) : rowsQuery.error ? (
      <Banner padded variant="error" testId="related-list-error">
        {dispatcherErrorText(rowsQuery.error, effectiveTranslate)}
      </Banner>
    ) : (
      <>
        {truncated && (
          <Banner variant="info" testId="related-list-truncated">
            {effectiveTranslate("kumiko.list.related-list-truncated", {
              count: sortedRows.length,
            })}
          </Banner>
        )}
        {emptyStateActionError !== null && (
          <Banner variant="error" testId="related-list-empty-state-action-error">
            {emptyStateActionError}
          </Banner>
        )}
        <PageHeaderSlotAvailableProvider value={false}>
          <RenderList
            screen={listScreen}
            entity={entity}
            rows={sortedRows}
            featureName={listFeatureName ?? featureName}
            translate={effectiveTranslate}
            {...(section.description !== undefined && { description: section.description })}
            {...(section.itemNoun !== undefined && { itemNounKey: section.itemNoun })}
            sort={sort}
            onSortChange={setSort}
            {...(section.searchable === true && {
              searchable: true,
              searchValue: search,
              onSearchChange: setSearch,
            })}
            {...(filterFacets.length > 0 && {
              filterFacets,
              filterValues: filters,
              onFilterChange,
              onFilterReset,
            })}
            {...(onRowClick !== undefined && { onRowClick })}
            {...(rowActions !== undefined && { rowActions })}
            {...(section.rowActionMode !== undefined && { rowActionMode: section.rowActionMode })}
            {...(rowGrouping !== undefined && { rowGrouping })}
            {...(rowTone !== undefined && { rowTone })}
            {...(toolbarActionButtons !== undefined && { toolbarActions: toolbarActionButtons })}
            {...(emptyStateContent !== undefined && { emptyState: emptyStateContent })}
            screenPadding={false}
            {...(hideTitle === true && { scrollBody: true, chromeless: true })}
            {...(embedded === true && { chromeless: true })}
          />
        </PageHeaderSlotAvailableProvider>
      </>
    );

  // hideTitle (tabs mode) → the caller (render-edit.tsx) already wraps this
  // component's own return value in the same Card frame every other tab
  // kind gets — no card here, or the two would nest. `scrollBody` caps the
  // table to the panel height; `FillContainer` is this section's link in the
  // fillHeight flex chain that Card's `options.fillHeight` continues (see
  // render-edit.tsx). A platform primitive (not a raw `<div>`) because
  // `renderer` stays DOM-free. Stacked (non-tabs) sections keep their own
  // Section card and document-flow height since they render a visible title
  // and aren't confined to a tab panel.
  const bridges = <ReferenceFacetBridges specs={facetSpecs} onOptions={handleFacetOptions} />;

  if (embedded === true) {
    const countSuffix = rowsQuery.data !== null ? ` · ${sortedRows.length}` : "";
    return (
      <>
        {bridges}
        <Card
          options={{ framed: false, padded: false }}
          // Trim the default header inset: the host row already pads the area.
          className="[&>div:first-child]:px-0 [&>div:first-child]:pt-1 [&>div:first-child]:pb-2"
          slots={{
            title: `${section.title}${countSuffix}`,
            ...(actions !== undefined && { headerActions: actions }),
          }}
          testId={`related-list-${section.title}-${parentId}`}
        >
          {content}
        </Card>
      </>
    );
  }

  if (hideTitle) {
    return (
      <>
        {bridges}
        {FillContainer !== undefined ? (
          <FillContainer {...(grow === true && { grow: true })}>{content}</FillContainer>
        ) : (
          content
        )}
      </>
    );
  }

  return (
    <>
      {bridges}
      <Section
        title={section.title}
        {...(actions !== undefined && { actions })}
        testId={`related-list-${section.title}`}
      >
        {content}
      </Section>
    </>
  );
}

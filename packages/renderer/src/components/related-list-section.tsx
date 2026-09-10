import type {
  EntityDefinition,
  EntityListScreenDefinition,
  RowActionDrawer,
  RowActionNavigate,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { normalizeListColumn } from "@cosmicdrift/kumiko-framework/ui-types";
import type {
  EditRelatedListSectionViewModel,
  ListRowViewModel,
  Translate,
} from "@cosmicdrift/kumiko-headless";
import { type ReactNode, useMemo, useState } from "react";
import { useNav } from "../app/nav";
import {
  buildProjectionRowActions,
  rowActionModeFor,
  runProjectionRowNavigate,
} from "../app/row-actions";
import { dispatcherErrorText } from "../app/write-failed-error";
import { useOptionalDispatcher } from "../context/dispatcher-context";
import type { ListSort } from "../hooks/use-list-url-state";
import { useQuery } from "../hooks/use-query";
import { useTranslation } from "../i18n";
import { usePrimitives } from "../primitives";
import { sortByAccessor } from "../sort-by-accessor";
import { RenderList } from "./render-list";

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
// relatedList section has no single Zod schema to derive it from.
function synthesizeRelatedListEntity(
  columns: EditRelatedListSectionViewModel["columns"],
): EntityDefinition {
  const fields: Record<string, { type: "text"; sortable: boolean }> = {};
  for (const col of columns) {
    const normalized = normalizeListColumn(col);
    fields[normalized.field] = { type: "text", sortable: normalized.sortable === true };
  }
  return { fields } as unknown as EntityDefinition;
}

export function RelatedListSection({
  section,
  parentId,
  featureName,
  translate,
  hideTitle,
  onOpenDrawer,
}: {
  readonly section: EditRelatedListSectionViewModel;
  readonly parentId: string;
  readonly featureName: string;
  readonly translate?: Translate;
  readonly hideTitle?: boolean;
  /** Opens a drawer-kind rowAction (fw#2710). Supplied by the parent
   *  (ProjectionDetailBody), which owns schema + the actual Drawer render —
   *  this component only ever invokes the callback. */
  readonly onOpenDrawer?: (
    action: RowActionDrawer,
    initialValues: Readonly<Record<string, unknown>> | undefined,
  ) => void;
}): ReactNode {
  const { Banner, Section, FillContainer } = usePrimitives();
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  const nav = useNav();
  const dispatcher = useOptionalDispatcher();

  const entity = useMemo(() => synthesizeRelatedListEntity(section.columns), [section.columns]);
  const listScreen = useMemo(
    (): EntityListScreenDefinition => ({
      // Empty id → RenderList's own toolbarTitle resolves to "" (its
      // `screen:${id}.title` lookup misses and falls back to `id`) — this
      // component renders the visible heading itself via `Section` below,
      // so RenderList's toolbar carries none.
      id: "",
      type: "entityList",
      entity: RELATED_LIST_PSEUDO_ENTITY,
      columns: section.columns,
    }),
    [section.columns],
  );

  const payload = useMemo(
    () => ({
      [section.parentParam ?? "id"]: parentId,
      ...(section.pageSize !== undefined && { limit: section.pageSize }),
    }),
    [section.parentParam, section.pageSize, parentId],
  );

  const rowsQuery = useQuery<PagedRows>(section.query, payload);

  // Sorted client-side over the already-loaded rows — this section has no
  // pager (see `payload` above: a one-shot fetch, no cursor/offset), so the
  // loaded set already IS the full display set and there is no "other page"
  // a client-side sort could misleadingly hide (fw#2722).
  const [sort, setSort] = useState<ListSort | null>(section.defaultSort ?? null);
  const sortAccessors = useMemo(() => {
    const accessors: Record<string, (row: Readonly<Record<string, unknown>>) => string | number> =
      {};
    for (const col of section.columns) {
      const field = normalizeListColumn(col).field;
      accessors[field] = (row) => {
        const value = row[field];
        return typeof value === "number" ? value : String(value ?? "");
      };
    }
    return accessors;
  }, [section.columns]);
  const sortedRows = useMemo(
    () => sortByAccessor(rowsQuery.data?.rows ?? [], sort, sortAccessors),
    [rowsQuery.data, sort, sortAccessors],
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
          nav.navigate({ entity: rowClick.entity, id });
        }
      : rowClickAction !== undefined
        ? (row: ListRowViewModel) => runProjectionRowNavigate(nav, rowClickAction, row)
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
        refetch: rowsQuery.refetch,
        openDrawer: onOpenDrawer,
      }),
    [section.rowActions, effectiveTranslate, dispatcher, nav, rowsQuery.refetch, onOpenDrawer],
  );
  const rowActionMode = rowActionModeFor(rowActions);

  // A truncated fetch means `sortedRows` is a sort of a partial set, not of
  // the full related-row set — the client-side sort above (or even plain
  // unsorted display) would silently claim "these are the top N" when they
  // are really just "the first N in the server's own order" (fw#2722 review).
  // `nextCursor` is exactly how the paged envelope marks that: non-null means
  // more rows exist server-side beyond what was fetched.
  const truncated = rowsQuery.data !== null && rowsQuery.data.nextCursor !== null;

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
        <RenderList
          screen={listScreen}
          entity={entity}
          rows={sortedRows}
          featureName={featureName}
          translate={effectiveTranslate}
          sort={sort}
          onSortChange={setSort}
          {...(onRowClick !== undefined && { onRowClick })}
          {...(rowActions !== undefined && { rowActions })}
          {...(rowActionMode !== undefined && { rowActionMode })}
          {...(hideTitle === true && { chromeless: true, scrollBody: true })}
        />
      </>
    );

  // hideTitle (tabs mode) → the tab panel is already the boundary: no
  // Section card wrapper here, `chromeless` above drops the table's own
  // card frame too, and `scrollBody` fills this wrapper's height so a long
  // Akte tab scrolls internally instead of stretching the page (fw#2722) —
  // the list sits directly in the tab. `FillContainer` is this section's
  // link in RenderEdit's `fillHeight` chain (see render-edit.tsx): it is
  // always this section's own root whenever hideTitle is set, since tabs
  // mode narrows RenderEdit to exactly this one active section. A platform
  // primitive (not a raw `<div>`) because `renderer` stays DOM-free —
  // `Section`/`Card` were rejected for this spot in favor of a dedicated
  // chromeless primitive; see `FillContainerProps` in primitives.tsx.
  // Stacked (non-tabs) sections keep the card frame and document-flow
  // height since they render a visible title and aren't confined to a tab
  // panel.
  if (hideTitle) {
    return FillContainer !== undefined ? <FillContainer>{content}</FillContainer> : content;
  }

  return (
    <Section title={section.title} testId={`related-list-${section.title}`}>
      {content}
    </Section>
  );
}

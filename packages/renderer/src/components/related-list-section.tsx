import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { normalizeListColumn } from "@cosmicdrift/kumiko-framework/ui-types";
import type {
  EditRelatedListSectionViewModel,
  ListRowViewModel,
  Translate,
} from "@cosmicdrift/kumiko-headless";
import { type ReactNode, useMemo } from "react";
import { useNav } from "../app/nav";
import { dispatcherErrorText } from "../app/write-failed-error";
import { useQuery } from "../hooks/use-query";
import { useTranslation } from "../i18n";
import { usePrimitives } from "../primitives";
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
// projection-list-shim's synthesizeProjectionEntity, but relatedList columns
// aren't sortable (no sort UI on this section, see RelatedListSection below).
function synthesizeRelatedListEntity(
  columns: EditRelatedListSectionViewModel["columns"],
): EntityDefinition {
  const fields: Record<string, { type: "text" }> = {};
  for (const col of columns) {
    fields[normalizeListColumn(col).field] = { type: "text" };
  }
  return { fields } as unknown as EntityDefinition;
}

export function RelatedListSection({
  section,
  parentId,
  featureName,
  translate,
  hideTitle,
}: {
  readonly section: EditRelatedListSectionViewModel;
  readonly parentId: string;
  readonly featureName: string;
  readonly translate?: Translate;
  readonly hideTitle?: boolean;
}): ReactNode {
  const { Banner, Section } = usePrimitives();
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  const nav = useNav();

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

  const rowClick = section.rowClick;
  const onRowClick =
    rowClick !== undefined
      ? (row: ListRowViewModel) => {
          const id = String(row.values[rowClick.idColumn ?? "id"] ?? "");
          if (id === "") return;
          nav.navigate({ entity: rowClick.entity, id });
        }
      : undefined;

  return (
    <Section title={hideTitle ? undefined : section.title} testId={`related-list-${section.title}`}>
      {rowsQuery.loading && rowsQuery.data === null ? (
        <Banner padded variant="loading" testId="related-list-loading">
          Loading…
        </Banner>
      ) : rowsQuery.error ? (
        <Banner padded variant="error" testId="related-list-error">
          {dispatcherErrorText(rowsQuery.error, effectiveTranslate)}
        </Banner>
      ) : (
        <RenderList
          screen={listScreen}
          entity={entity}
          rows={rowsQuery.data?.rows ?? []}
          featureName={featureName}
          translate={effectiveTranslate}
          {...(onRowClick !== undefined && { onRowClick })}
        />
      )}
    </Section>
  );
}

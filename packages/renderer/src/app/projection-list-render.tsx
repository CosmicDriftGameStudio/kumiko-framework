import type { ProjectionListScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import { RenderList } from "../components/render-list.tsx";
import type { ListRowViewModel, Translate } from "../headless/index.ts";
import type { usePrimitives } from "../primitives.tsx";
import type { FeatureSchema } from "./feature-schema.ts";
import { isListNarrowed } from "./list-empty-content.ts";
import {
  projectionActionProps,
  projectionFacetProps,
  projectionFilterStateProps,
  projectionLayoutProps,
  projectionLeadProps,
} from "./projection-list-render-props.ts";
import { QueryErrorBanner } from "./query-state-banners.tsx";
import type { useProjectionListActions } from "./use-projection-list-actions.ts";
import type { useProjectionListData } from "./use-projection-list-data.ts";
import type { useProjectionListDefinitions } from "./use-projection-list-definitions.ts";
import type { useProjectionListQuery } from "./use-projection-list-query.ts";
import type { listPager, ScreenListRows } from "./use-screen-list-rows.ts";

export type ProjectionListRenderModel = {
  readonly schema: FeatureSchema;
  readonly screen: ProjectionListScreenDefinition;
  readonly translate: Translate | undefined;
  readonly effectiveTranslate: Translate;
  readonly isEmbeddedScreen: boolean;
  readonly definitions: ReturnType<typeof useProjectionListDefinitions>;
  readonly query: ReturnType<typeof useProjectionListQuery>;
  readonly data: ReturnType<typeof useProjectionListData>;
  readonly actions: ReturnType<typeof useProjectionListActions>;
  readonly pager: ReturnType<typeof listPager>;
  readonly wrappedOnRowClick: ((row: ListRowViewModel) => void) | undefined;
};

export function renderQueryRetryBanner(
  listRows: ScreenListRows,
  error: NonNullable<ScreenListRows["error"]>,
  effectiveTranslate: Translate,
): ReactNode {
  return <QueryErrorBanner error={error} translate={effectiveTranslate} onRetry={listRows.retry} />;
}

export function renderBadShapeBanner(
  screen: ProjectionListScreenDefinition,
  primitives: Pick<ReturnType<typeof usePrimitives>, "Banner" | "Text">,
): ReactNode {
  const { Banner, Text } = primitives;
  return (
    <Banner padded variant="error" testId="kumiko-screen-projection-list-bad-shape">
      Screen <Text variant="code">{screen.id}</Text> query{" "}
      <Text variant="code">{screen.query}</Text> did not return a PagedRows envelope; a
      projectionList query must return <Text variant="code">{"{ rows, nextCursor }"}</Text>.
    </Banner>
  );
}

export function renderProjectionList(model: ProjectionListRenderModel): ReactNode {
  const { schema, screen, translate, effectiveTranslate, isEmbeddedScreen } = model;
  const { definitions, query, data, actions, pager, wrappedOnRowClick } = model;
  const { urlState } = query;
  const { filterFacets, listRows, listTable } = data;
  const { dateRangeFacets } = query;
  return (
    <RenderList
      screen={definitions.listScreen}
      entity={definitions.entity}
      rows={listRows.rows}
      featureName={schema.featureName}
      searchable={definitions.searchable}
      narrowed={
        query.activeNamedFilter !== undefined ||
        isListNarrowed(query.activeSearch, urlState.filters)
      }
      {...projectionLeadProps(screen, effectiveTranslate, actions.emptyContent)}
      searchValue={urlState.q}
      onSearchChange={urlState.setQ}
      sort={query.activeSort}
      onSortChange={urlState.setSort}
      {...projectionLayoutProps(
        isEmbeddedScreen,
        screen,
        definitions.listScreen,
        pager,
        actions.rowActions,
      )}
      {...projectionActionProps(actions, translate, wrappedOnRowClick)}
      {...projectionFacetProps(
        filterFacets,
        dateRangeFacets,
        query.handleDateRangeChange,
        urlState,
      )}
      {...listTable.props}
      {...projectionFilterStateProps(
        filterFacets,
        dateRangeFacets,
        urlState,
        query.activeNamedFilter,
      )}
    />
  );
}

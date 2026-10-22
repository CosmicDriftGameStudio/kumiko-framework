import type {
  EntityListScreenDefinition,
  ProjectionListScreenDefinition,
} from "@cosmicdrift/kumiko-types/screen";
import { useMemo } from "react";
import { useListStateStore } from "../components/list-state-store.tsx";
import type { Translate } from "../headless/index.ts";
import type { ListGroupPaging } from "../hooks/list-group-pages.ts";
import { type ListAggregates, useListAggregates } from "../hooks/use-list-aggregates.ts";
import { type ListTableProps, useListTable } from "../hooks/use-list-table.ts";
import { listViewSchemaColumns } from "../hooks/use-list-view-state.ts";
import { useRememberedListParams } from "../hooks/use-remembered-list-params.ts";
import type { DataTableTableBlockProps } from "../primitives.tsx";

type ScreenListTableArgs = {
  readonly screen: EntityListScreenDefinition | ProjectionListScreenDefinition;
  readonly featureName: string;
  /** The list query payload as sent; paging keys are stripped for the export. */
  readonly payload: Readonly<Record<string, unknown>>;
  readonly filterFields: readonly string[];
  readonly queryType: string;
  readonly pageSize: number;
  readonly paging: ListGroupPaging;
  readonly translate: Translate;
};

export type ScreenListTable = {
  readonly props: ListTableProps &
    Pick<DataTableTableBlockProps, "serverGroups" | "totals" | "notice">;
  readonly aggregates: ListAggregates;
};

/** Table-block wiring of a URL-backed list screen (entityList, projectionList). */
export function useScreenListTable({
  screen,
  featureName,
  payload,
  filterFields,
  queryType,
  pageSize,
  paging,
  translate,
}: ScreenListTableArgs): ScreenListTable {
  const { id: screenId, table, columns } = screen;
  const store = useListStateStore();
  const schemaColumns = useMemo(() => listViewSchemaColumns(columns), [columns]);
  const known = useMemo(
    () => ({ columnFields: schemaColumns.map((column) => column.field), filterFields }),
    [schemaColumns, filterFields],
  );
  useRememberedListParams({
    screenId,
    enabled: table?.rememberState === true,
    store,
    known,
  });
  const exportSource = useMemo(
    () => ({ screen: `${featureName}:screen:${screenId}`, screenShortId: screenId, payload }),
    [featureName, screenId, payload],
  );
  const { props, groupField } = useListTable({
    storeKey: screenId,
    table,
    schemaColumns,
    url: { screenId },
    exportSource,
  });
  const aggregates = useListAggregates({
    queryType,
    payload,
    table,
    groupField,
    pageSize,
    paging,
    translate,
  });
  const { serverGroups, totals, notice } = aggregates;
  return {
    props: {
      ...props,
      ...(serverGroups !== undefined && { serverGroups }),
      ...(totals !== undefined && { totals }),
      ...(notice !== undefined && { notice }),
    },
    aggregates,
  };
}

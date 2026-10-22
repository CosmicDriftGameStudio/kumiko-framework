import type {
  EntityListScreenDefinition,
  ProjectionListScreenDefinition,
} from "@cosmicdrift/kumiko-types/screen";
import { useMemo } from "react";
import { useListStateStore } from "../components/list-state-store.tsx";
import { type ListTableProps, useListTable } from "../hooks/use-list-table.ts";
import { listViewSchemaColumns } from "../hooks/use-list-view-state.ts";
import { useRememberedListParams } from "../hooks/use-remembered-list-params.ts";

type ScreenListTableArgs = {
  readonly screen: EntityListScreenDefinition | ProjectionListScreenDefinition;
  readonly featureName: string;
  /** The list query payload as sent; paging keys are stripped for the export. */
  readonly payload: Readonly<Record<string, unknown>>;
  readonly filterFields: readonly string[];
};

/** Table-block wiring of a URL-backed list screen (entityList, projectionList). */
export function useScreenListTable({
  screen,
  featureName,
  payload,
  filterFields,
}: ScreenListTableArgs): ListTableProps {
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
  return useListTable({
    storeKey: screenId,
    table,
    schemaColumns,
    url: { screenId },
    exportSource,
  });
}

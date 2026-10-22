import type { ListColumnSpec, ListTableOptions } from "@cosmicdrift/kumiko-types/screen";
import { useMemo } from "react";
import { useListStateStore } from "../components/list-state-store.tsx";
import { type ListTableProps, useListTable } from "../hooks/use-list-table.ts";
import { listViewSchemaColumns } from "../hooks/use-list-view-state.ts";
import { useRememberedListParams } from "../hooks/use-remembered-list-params.ts";

type ScreenListTableArgs = {
  readonly screenId: string;
  readonly table: ListTableOptions | undefined;
  readonly columns: readonly ListColumnSpec[];
  readonly filterFields: readonly string[];
};

/** Table-block wiring of a URL-backed list screen (entityList, projectionList). */
export function useScreenListTable({
  screenId,
  table,
  columns,
  filterFields,
}: ScreenListTableArgs): ListTableProps {
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
  return useListTable({ storeKey: screenId, table, schemaColumns, url: { screenId } });
}

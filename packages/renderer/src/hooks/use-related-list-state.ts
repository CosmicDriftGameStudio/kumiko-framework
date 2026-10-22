import { useMemo } from "react";
import { useListStateStore } from "../components/list-state-store.tsx";
import type { EditRelatedListSectionViewModel } from "../headless/index.ts";
import { useListTable } from "./use-list-table.ts";
import { listViewSchemaColumns } from "./use-list-view-state.ts";
import { useRememberedLocalListState } from "./use-remembered-local-list-state.ts";

/** Search, filters and sort of a relatedList section (component-local: it has
 *  no URL namespace) plus the DataTable props of its `table` block. */
export function useRelatedListState(
  section: EditRelatedListSectionViewModel,
  parentScreenId: string | undefined,
) {
  const store = useListStateStore();
  const storeKey = `${parentScreenId ?? ""}#${section.id ?? section.query}`;
  const defaultSort = useMemo(() => section.defaultSort ?? null, [section.defaultSort]);
  const schemaColumns = useMemo(() => listViewSchemaColumns(section.columns), [section.columns]);
  const known = useMemo(
    () => ({
      columnFields: schemaColumns.map((column) => column.field),
      filterFields: (section.facets ?? []).map((facet) => facet.field),
    }),
    [schemaColumns, section.facets],
  );
  const local = useRememberedLocalListState({
    storeKey,
    store,
    remember: section.table?.rememberState === true,
    defaultSort,
    known,
  });
  const listTable = useListTable({
    storeKey,
    table: section.table,
    schemaColumns,
    local: { atDefault: local.atDefault, reset: local.reset },
  });
  return { ...local, listTable };
}

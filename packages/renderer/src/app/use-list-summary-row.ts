import { SELECT_OPTION_TONES } from "@cosmicdrift/kumiko-types/fields";
import type { ListTableSummaryRow } from "@cosmicdrift/kumiko-types/screen";
import { isOneOf, isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { useMemo } from "react";
import type { DataTableSummaryItem, DataTableSummaryRow } from "../data-table-view-types.ts";
import { useQuery } from "../hooks/use-query.ts";
import { namedFilterCountPayload } from "./named-filter-facet.ts";

// The list's narrowing without paging and sort; the summary query answers for the whole filtered list.
export function summaryRowPayload(
  listPayload: Readonly<Record<string, unknown>>,
  params: ListTableSummaryRow["params"],
): Record<string, unknown> {
  const {
    limit: _limit,
    totalCount: _totalCount,
    ...narrowing
  } = namedFilterCountPayload(listPayload);
  // The list's own keys win: a param must not widen the numbers beyond what the list shows.
  return { ...params, ...narrowing };
}

function isSummaryItem(value: unknown): value is DataTableSummaryItem {
  return (
    isPlainObject(value) &&
    typeof value["label"] === "string" &&
    (typeof value["value"] === "string" || typeof value["value"] === "number") &&
    (value["tone"] === undefined || isOneOf(SELECT_OPTION_TONES, value["tone"]))
  );
}

export function parseSummaryItems(data: unknown): readonly DataTableSummaryItem[] {
  if (!isPlainObject(data) || !Array.isArray(data["items"])) return [];
  return data["items"].filter(isSummaryItem);
}

/** One query for the whole table block; absent `summaryRow` leaves it disabled. */
export function useListSummaryRow({
  summaryRow,
  payload,
  paused,
}: {
  readonly summaryRow: ListTableSummaryRow | undefined;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly paused: boolean;
}): DataTableSummaryRow | undefined {
  const queryPayload = useMemo(
    () => summaryRowPayload(payload, summaryRow?.params),
    [payload, summaryRow?.params],
  );
  const result = useQuery<unknown>(summaryRow?.query ?? "", queryPayload, {
    enabled: summaryRow !== undefined && !paused,
    live: true,
  });
  const items = useMemo(() => parseSummaryItems(result.data), [result.data]);
  return summaryRow === undefined || items.length === 0 ? undefined : { items };
}

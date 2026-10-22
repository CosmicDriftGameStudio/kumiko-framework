import {
  isListAggregateResult,
  type ListAggregateResult,
} from "@cosmicdrift/kumiko-types/list-aggregate-types";
import type { ListTableOptions } from "@cosmicdrift/kumiko-types/screen";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DataTableListNotice,
  DataTableServerGroups,
  DataTableTotals,
} from "../data-table-aggregate-types.ts";
import type { DispatcherError, Translate } from "../headless/index.ts";
import {
  type ListGroupPageRequest,
  type ListGroupPageResult,
  type ListGroupPaging,
  withoutListPaging,
} from "./list-group-pages.ts";
import { buildServerGroups, measuresOf, type ServerGroupsBuild } from "./list-server-groups.ts";
import { useGroupLoadState } from "./use-group-load-state.ts";
import { useQuery } from "./use-query.ts";

const EMPTY_BUILD: ServerGroupsBuild = { groups: [], rows: [], requests: [] };

type ListAggregatesArgs = {
  readonly queryType: string;
  /** The list payload as the ungrouped list would send it; paging keys are dropped. */
  readonly payload: Readonly<Record<string, unknown>>;
  readonly table: ListTableOptions | undefined;
  readonly groupField: string | undefined;
  readonly pageSize: number;
  readonly paging: ListGroupPaging;
  readonly translate: Translate;
};

export type ListGroupPagesProps = {
  readonly queryType: string;
  readonly requests: readonly ListGroupPageRequest[];
  readonly onResult: (pageKey: string, result: ListGroupPageResult) => void;
  readonly refreshNonce: number;
};

export type ListAggregates = {
  readonly grouped: boolean;
  /** Loaded rows of the open groups, in group order. */
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly serverGroups?: DataTableServerGroups;
  readonly totals?: DataTableTotals;
  readonly notice?: DataTableListNotice;
  readonly groupPages: ListGroupPagesProps;
  /** Reloads groups, totals and the loaded group pages (after a write). */
  readonly refresh: () => void;
  /** True until the first group answer is in. */
  readonly loading: boolean;
  readonly error: DispatcherError | null;
};

function aggregateOf(data: unknown): ListAggregateResult | undefined {
  return isListAggregateResult(data) ? data : undefined;
}

function noticeOf(
  groups: ListAggregateResult | undefined,
  totals: ListAggregateResult | undefined,
): DataTableListNotice | undefined {
  if (groups?.truncated === true) return "truncated";
  if (groups?.searchTruncated === true || totals?.searchTruncated === true) {
    return "searchTruncated";
  }
  return undefined;
}

type MeasureRequest = { readonly field: string; readonly kind: string };

/** The groups and totals aggregate queries plus a refresh that reloads both. */
function useAggregateQueries(args: {
  readonly queryType: string;
  readonly base: Readonly<Record<string, unknown>>;
  readonly groupField: string | undefined;
  readonly measures: readonly MeasureRequest[];
}) {
  const { queryType, base, groupField, measures } = args;
  const grouped = groupField !== undefined;
  const withTotals = measures.length > 0;
  const groupsPayload = useMemo(
    () => ({ ...base, aggregate: { groupBy: groupField, measures } }),
    [base, groupField, measures],
  );
  const totalsPayload = useMemo(() => ({ ...base, aggregate: { measures } }), [base, measures]);
  const groupsQuery = useQuery<unknown>(queryType, groupsPayload, { live: true, enabled: grouped });
  const totalsQuery = useQuery<unknown>(queryType, totalsPayload, {
    live: true,
    enabled: withTotals,
  });

  const [refreshNonce, setRefreshNonce] = useState(0);
  const refetchGroups = groupsQuery.refetch;
  const refetchTotals = totalsQuery.refetch;
  const refresh = useCallback(() => setRefreshNonce((n) => n + 1), []);
  useEffect(() => {
    // skip: the mount fetch already covers the first nonce
    if (refreshNonce === 0) return;
    if (grouped) void refetchGroups();
    if (withTotals) void refetchTotals();
  }, [refreshNonce, grouped, withTotals, refetchGroups, refetchTotals]);

  return {
    groupsAnswer: grouped ? aggregateOf(groupsQuery.data) : undefined,
    totalsAnswer: withTotals ? aggregateOf(totalsQuery.data) : undefined,
    groupsError: grouped ? groupsQuery.error : null,
    refresh,
    refreshNonce,
  };
}

/** Server-side grouping and totals of a list: groups are the load unit, each open
 *  and visible group pages through its own rows; nothing is summed on the client. */
export function useListAggregates({
  queryType,
  payload,
  table,
  groupField,
  pageSize,
  paging,
  translate,
}: ListAggregatesArgs): ListAggregates {
  const grouping = table?.grouping;
  const totalSpecs = useMemo(() => table?.totals ?? [], [table?.totals]);
  const base = useMemo(() => withoutListPaging(payload), [payload]);
  const baseKey = JSON.stringify(base);
  const measures = useMemo(
    () => totalSpecs.map((total) => ({ field: total.field, kind: total.kind })),
    [totalSpecs],
  );
  const grouped = groupField !== undefined;

  const { groupsAnswer, totalsAnswer, groupsError, refresh, refreshNonce } = useAggregateQueries({
    queryType,
    base,
    groupField,
    measures,
  });

  const { state, onToggle, onHeaderVisible, onLoadMore, onResult } = useGroupLoadState(
    `${groupField ?? ""}|${baseKey}`,
  );
  const active = groupField !== undefined && groupsAnswer !== undefined;
  const { groups, rows, requests } = active
    ? buildServerGroups({
        answer: groupsAnswer.groups,
        groupField,
        declared: grouping?.field === groupField ? grouping : undefined,
        state,
        base,
        pageSize,
        paging,
        measures: totalSpecs,
        translate,
      })
    : EMPTY_BUILD;
  const serverGroups: DataTableServerGroups | undefined = active
    ? {
        field: groupField,
        groups,
        totalCount: groups.reduce((sum, group) => sum + group.count, 0),
        onToggle,
        onLoadMore,
        onHeaderVisible,
      }
    : undefined;
  const totals: DataTableTotals | undefined =
    totalsAnswer !== undefined
      ? { measures: measuresOf(totalSpecs, totalsAnswer.groups[0]) }
      : undefined;
  const notice = noticeOf(groupsAnswer, totalsAnswer);

  return {
    grouped,
    rows,
    ...(serverGroups !== undefined && { serverGroups }),
    ...(totals !== undefined && { totals }),
    ...(notice !== undefined && { notice }),
    groupPages: { queryType, requests, onResult, refreshNonce },
    refresh,
    loading: grouped && groupsAnswer === undefined && groupsError === null,
    error: groupsError,
  };
}

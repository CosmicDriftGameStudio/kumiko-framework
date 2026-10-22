import {
  isListAggregateResult,
  type ListAggregateGroup,
  type ListAggregateResult,
} from "@cosmicdrift/kumiko-types/list-aggregate-types";
import {
  type ListTableOptions,
  relatedListGroupHeaderLabel,
  relatedListGroupKey,
} from "@cosmicdrift/kumiko-types/screen";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DataTableListNotice,
  DataTableMeasure,
  DataTableServerGroup,
  DataTableServerGroups,
  DataTableTotals,
} from "../data-table-aggregate-types.ts";
import type { DispatcherError, Translate } from "../headless/index.ts";
import {
  groupPageKey,
  groupPagePayload,
  type ListGroupPageRequest,
  type ListGroupPageResult,
  type ListGroupPaging,
  loadedGroupPages,
  withoutListPaging,
} from "./list-group-pages.ts";
import { useQuery } from "./use-query.ts";

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

type GroupLoadState = {
  readonly resetKey: string;
  readonly toggled: ReadonlySet<string>;
  readonly visible: ReadonlySet<string>;
  readonly requestedPages: ReadonlyMap<string, number>;
  readonly results: ReadonlyMap<string, ListGroupPageResult>;
};

function freshLoadState(resetKey: string): GroupLoadState {
  return {
    resetKey,
    toggled: new Set(),
    visible: new Set(),
    requestedPages: new Map(),
    results: new Map(),
  };
}

function aggregateOf(data: unknown): ListAggregateResult | undefined {
  return isListAggregateResult(data) ? data : undefined;
}

function measuresOf(
  totals: readonly { readonly field: string; readonly kind: DataTableMeasure["kind"] }[],
  group: ListAggregateGroup | undefined,
): DataTableMeasure[] {
  return totals.map((total, index) => ({
    field: total.field,
    kind: total.kind,
    value: group?.measures[index] ?? null,
  }));
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

function withToggled(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
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

  const groupsPayload = useMemo(
    () => ({ ...base, aggregate: { groupBy: groupField, measures } }),
    [base, groupField, measures],
  );
  const totalsPayload = useMemo(() => ({ ...base, aggregate: { measures } }), [base, measures]);
  const groupsQuery = useQuery<unknown>(queryType, groupsPayload, { live: true, enabled: grouped });
  const totalsQuery = useQuery<unknown>(queryType, totalsPayload, {
    live: true,
    enabled: measures.length > 0,
  });
  const groupsAnswer = grouped ? aggregateOf(groupsQuery.data) : undefined;
  const totalsAnswer = measures.length > 0 ? aggregateOf(totalsQuery.data) : undefined;

  const [refreshNonce, setRefreshNonce] = useState(0);
  const refetchGroups = groupsQuery.refetch;
  const refetchTotals = totalsQuery.refetch;
  const refresh = useCallback(() => setRefreshNonce((n) => n + 1), []);
  useEffect(() => {
    // skip: the mount fetch already covers the first nonce
    if (refreshNonce === 0) return;
    if (grouped) void refetchGroups();
    if (measures.length > 0) void refetchTotals();
  }, [refreshNonce, grouped, measures.length, refetchGroups, refetchTotals]);

  const resetKey = `${groupField ?? ""}|${baseKey}`;
  const [loadState, setLoadState] = useState(() => freshLoadState(resetKey));
  const state = loadState.resetKey === resetKey ? loadState : freshLoadState(resetKey);
  if (loadState.resetKey !== resetKey) setLoadState(state);

  const update = useCallback(
    (change: (current: GroupLoadState) => GroupLoadState) =>
      setLoadState((current) => (current.resetKey === resetKey ? change(current) : current)),
    [resetKey],
  );
  const onToggle = useCallback(
    (key: string) =>
      update((current) => ({ ...current, toggled: withToggled(current.toggled, key) })),
    [update],
  );
  const onHeaderVisible = useCallback(
    (key: string) =>
      update((current) =>
        current.visible.has(key)
          ? current
          : { ...current, visible: new Set([...current.visible, key]) },
      ),
    [update],
  );
  const onLoadMore = useCallback(
    (key: string) =>
      update((current) => {
        const requestedPages = new Map(current.requestedPages);
        requestedPages.set(key, (current.requestedPages.get(key) ?? 1) + 1);
        return { ...current, requestedPages };
      }),
    [update],
  );
  const onResult = useCallback(
    (pageKey: string, result: ListGroupPageResult) =>
      update((current) => {
        const results = new Map(current.results);
        results.set(pageKey, result);
        return { ...current, results };
      }),
    [update],
  );

  const sameGrouping = grouping?.field === groupField;
  const startsCollapsed = (key: string): boolean =>
    sameGrouping &&
    grouping?.collapsedWhen !== undefined &&
    key === relatedListGroupKey(grouping.collapsedWhen);
  const headerLabel = (key: string, group: ListAggregateGroup): string | undefined => {
    const serverLabel = group.label ?? undefined;
    const labelKey =
      sameGrouping && grouping !== undefined
        ? relatedListGroupHeaderLabel(grouping, key)
        : undefined;
    if (labelKey === undefined) return serverLabel;
    return translate(labelKey, { count: group.count, value: serverLabel ?? key });
  };

  const requests: ListGroupPageRequest[] = [];
  const rows: Readonly<Record<string, unknown>>[] = [];
  const groups: DataTableServerGroup[] = [];
  for (const group of groupsAnswer?.groups ?? []) {
    if (groupField === undefined) break;
    const key = relatedListGroupKey(group.key);
    const collapsed = startsCollapsed(key) !== state.toggled.has(key);
    const requestedPages = state.requestedPages.get(key) ?? 1;
    const pages = collapsed ? [] : loadedGroupPages(state.results, key, requestedPages);
    if (!collapsed && state.visible.has(key)) {
      for (let pageIndex = 0; pageIndex < requestedPages; pageIndex++) {
        const cursor = pageIndex === 0 ? undefined : pages[pageIndex - 1]?.nextCursor;
        // skip: a cursor page waits for the page before it
        if (paging === "cursor" && pageIndex > 0 && (cursor === undefined || cursor === null))
          break;
        requests.push({
          pageKey: groupPageKey(key, pageIndex),
          payload: groupPagePayload({
            base,
            groupField,
            groupValue: group.key,
            pageSize,
            pageIndex,
            paging,
            cursor: cursor ?? undefined,
          }),
        });
      }
    }
    const groupRows = pages.flatMap((page) => page.rows);
    rows.push(...groupRows);
    const lastPage = pages[pages.length - 1];
    const loading =
      !collapsed &&
      state.visible.has(key) &&
      (pages.length < requestedPages || pages.some((page) => page.loading));
    const label = headerLabel(key, group);
    groups.push({
      key,
      value: group.key,
      ...(label !== undefined && { label }),
      count: group.count,
      measures: measuresOf(totalSpecs, group),
      collapsed,
      rowCount: groupRows.length,
      hasMore:
        groupRows.length < group.count && (paging === "offset" || lastPage?.nextCursor !== null),
      loading,
    });
  }

  const serverGroups: DataTableServerGroups | undefined =
    groupField !== undefined && groupsAnswer !== undefined
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
    loading: grouped && groupsAnswer === undefined && groupsQuery.error === null,
    error: grouped ? groupsQuery.error : null,
  };
}

import type { ListAggregateGroup } from "@cosmicdrift/kumiko-types/list-aggregate-types";
import {
  type ListTableGrouping,
  relatedListGroupHeaderLabel,
  relatedListGroupKey,
} from "@cosmicdrift/kumiko-types/screen";
import type { DataTableMeasure, DataTableServerGroup } from "../data-table-aggregate-types.ts";
import type { Translate } from "../headless/index.ts";
import {
  groupPageKey,
  groupPagePayload,
  type ListGroupPageRequest,
  type ListGroupPageResult,
  type ListGroupPaging,
  loadedGroupPages,
} from "./list-group-pages.ts";

export type GroupLoadState = {
  readonly resetKey: string;
  readonly toggled: ReadonlySet<string>;
  readonly visible: ReadonlySet<string>;
  readonly requestedPages: ReadonlyMap<string, number>;
  readonly results: ReadonlyMap<string, ListGroupPageResult>;
};

export type MeasureSpec = { readonly field: string; readonly kind: DataTableMeasure["kind"] };

type Row = Readonly<Record<string, unknown>>;

export function freshLoadState(resetKey: string): GroupLoadState {
  return {
    resetKey,
    toggled: new Set(),
    visible: new Set(),
    requestedPages: new Map(),
    results: new Map(),
  };
}

export function measuresOf(
  totals: readonly MeasureSpec[],
  group: ListAggregateGroup | undefined,
): DataTableMeasure[] {
  return totals.map((total, index) => ({
    field: total.field,
    kind: total.kind,
    value: group?.measures[index] ?? null,
  }));
}

type ServerGroupsInput = {
  readonly answer: readonly ListAggregateGroup[];
  readonly groupField: string;
  /** The declared grouping, only when the active field is the declared one. */
  readonly declared: ListTableGrouping | undefined;
  readonly state: GroupLoadState;
  readonly base: Readonly<Record<string, unknown>>;
  readonly pageSize: number;
  readonly paging: ListGroupPaging;
  readonly measures: readonly MeasureSpec[];
  readonly translate: Translate;
};

export type ServerGroupsBuild = {
  readonly groups: DataTableServerGroup[];
  readonly rows: Row[];
  readonly requests: ListGroupPageRequest[];
};

function startsCollapsed(declared: ListTableGrouping | undefined, key: string): boolean {
  return (
    declared?.collapsedWhen !== undefined && key === relatedListGroupKey(declared.collapsedWhen)
  );
}

function headerLabel(
  input: ServerGroupsInput,
  key: string,
  group: ListAggregateGroup,
): string | undefined {
  const serverLabel = group.label ?? undefined;
  const labelKey =
    input.declared === undefined ? undefined : relatedListGroupHeaderLabel(input.declared, key);
  if (labelKey === undefined) return serverLabel;
  return input.translate(labelKey, { count: group.count, value: serverLabel ?? key });
}

function pageRequests(
  input: ServerGroupsInput,
  group: ListAggregateGroup,
  key: string,
  pages: readonly ListGroupPageResult[],
  requestedPages: number,
): ListGroupPageRequest[] {
  const requests: ListGroupPageRequest[] = [];
  for (let pageIndex = 0; pageIndex < requestedPages; pageIndex++) {
    const cursor = pageIndex === 0 ? undefined : (pages[pageIndex - 1]?.nextCursor ?? undefined);
    // skip: a cursor page waits for the page before it
    if (input.paging === "cursor" && pageIndex > 0 && cursor === undefined) break;
    requests.push({
      pageKey: groupPageKey(key, pageIndex),
      payload: groupPagePayload({
        base: input.base,
        groupField: input.groupField,
        groupValue: group.key,
        pageSize: input.pageSize,
        pageIndex,
        paging: input.paging,
        cursor,
      }),
    });
  }
  return requests;
}

function hasMoreRows(
  paging: ListGroupPaging,
  loaded: number,
  count: number,
  lastPage: ListGroupPageResult | undefined,
): boolean {
  return loaded < count && (paging === "offset" || lastPage?.nextCursor !== null);
}

function buildGroup(input: ServerGroupsInput, group: ListAggregateGroup, into: ServerGroupsBuild) {
  const { state } = input;
  const key = relatedListGroupKey(group.key);
  const collapsed = startsCollapsed(input.declared, key) !== state.toggled.has(key);
  const requestedPages = state.requestedPages.get(key) ?? 1;
  const pages = collapsed ? [] : loadedGroupPages(state.results, key, requestedPages);
  const loadsRows = !collapsed && state.visible.has(key);
  if (loadsRows) into.requests.push(...pageRequests(input, group, key, pages, requestedPages));
  const groupRows = pages.flatMap((page) => page.rows);
  into.rows.push(...groupRows);
  const label = headerLabel(input, key, group);
  into.groups.push({
    key,
    value: group.key,
    ...(label !== undefined && { label }),
    count: group.count,
    measures: measuresOf(input.measures, group),
    collapsed,
    rowCount: groupRows.length,
    hasMore: hasMoreRows(input.paging, groupRows.length, group.count, pages[pages.length - 1]),
    loading: loadsRows && (pages.length < requestedPages || pages.some((page) => page.loading)),
  });
}

/** Header entries, loaded rows and the page requests of the open, visible groups. */
export function buildServerGroups(input: ServerGroupsInput): ServerGroupsBuild {
  const build: ServerGroupsBuild = { groups: [], rows: [], requests: [] };
  for (const group of input.answer) buildGroup(input, group, build);
  return build;
}

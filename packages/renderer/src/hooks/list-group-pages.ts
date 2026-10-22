import type { AggregateKey } from "@cosmicdrift/kumiko-types/aggregate-types";

/** How a group pages through its rows: offset for `pagination: "pages"`, cursor for `"infinite"`. */
export type ListGroupPaging = "offset" | "cursor";

export type ListGroupPageResult = {
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly nextCursor: string | null;
  readonly loading: boolean;
};

export type ListGroupPageRequest = {
  readonly pageKey: string;
  readonly payload: Readonly<Record<string, unknown>>;
};

const PAGING_KEYS = ["limit", "offset", "cursor", "totalCount"] as const;

/** The list payload as the aggregate sees it: filters, search and screen filter, no paging. */
export function withoutListPaging(
  payload: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const kept: Record<string, unknown> = { ...payload };
  for (const key of PAGING_KEYS) delete kept[key];
  return kept;
}

export function groupPageKey(groupKey: string, pageIndex: number): string {
  return `${groupKey}#${pageIndex}`;
}

function existingFilters(base: Readonly<Record<string, unknown>>): readonly unknown[] {
  const filters = base["filters"];
  return Array.isArray(filters) ? filters : [];
}

export function groupPagePayload(args: {
  readonly base: Readonly<Record<string, unknown>>;
  readonly groupField: string;
  readonly groupValue: AggregateKey;
  readonly pageSize: number;
  readonly pageIndex: number;
  readonly paging: ListGroupPaging;
  readonly cursor: string | undefined;
}): Record<string, unknown> {
  const { base, groupField, groupValue, pageSize, pageIndex, paging, cursor } = args;
  const offset = pageIndex * pageSize;
  return {
    ...base,
    filters: [...existingFilters(base), { field: groupField, op: "eq", value: groupValue }],
    limit: pageSize,
    ...(paging === "offset" && offset > 0 && { offset }),
    ...(paging === "cursor" && cursor !== undefined && { cursor }),
  };
}

/** Loaded pages of one group in order, up to the first page that has not answered yet. */
export function loadedGroupPages(
  results: ReadonlyMap<string, ListGroupPageResult>,
  groupKey: string,
  requestedPages: number,
): ListGroupPageResult[] {
  const pages: ListGroupPageResult[] = [];
  for (let pageIndex = 0; pageIndex < requestedPages; pageIndex++) {
    const page = results.get(groupPageKey(groupKey, pageIndex));
    if (page === undefined) break;
    pages.push(page);
  }
  return pages;
}

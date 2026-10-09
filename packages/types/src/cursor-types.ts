import type { EntityId, TenantId } from "./identifiers.js";

export type CursorQueryOptions = {
  tenantId: TenantId;
  cursor?: string;
  limit?: number;
  filterIds?: readonly EntityId[];
  sort?: string;
  sortDirection?: "asc" | "desc";
};

export type CursorResult<T> = {
  rows: T[];
  nextCursor: string | null;
  /** Optional total row count — only present when the caller sets
   *  `totalCount: true` on the query. */
  total?: number;
  /** Set when the search backend returned as many candidates as it can in one
   *  response, so matches beyond that may be missing from `rows`. */
  searchTruncated?: true;
};

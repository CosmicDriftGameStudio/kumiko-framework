import type { EntityId, TenantId } from "./identifiers";

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
};

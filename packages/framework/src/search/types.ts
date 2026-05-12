import type { EntityId, TenantId } from "../engine/types/identifiers";

export type SearchAdapterConfig = {
  searchableFields: readonly string[];
  rankingFields?: readonly string[];
};

export type SearchDocument = {
  entityType: string;
  entityId: EntityId;
  weight: number;
  fields: Record<string, unknown>;
};

export type SearchResult = {
  entityType: string;
  entityId: EntityId;
};

export type SearchOptions = {
  limit?: number;
  filterType?: string;
};

export type SearchAdapter = {
  configure(tenantId: TenantId, config: SearchAdapterConfig): Promise<void>;
  index(tenantId: TenantId, doc: SearchDocument): Promise<void>;
  search(tenantId: TenantId, query: string, options?: SearchOptions): Promise<SearchResult[]>;
  remove(tenantId: TenantId, entityType: string, entityId: EntityId): Promise<void>;
  // Bulk variants. Default implementations loop over the single-doc methods —
  // adapters should override when the backend supports a real batch call
  // (Meilisearch, Elasticsearch, Typesense all do). Cuts a batch-write from
  // N sequential HTTP + waitTask round-trips to one.
  indexBatch?(tenantId: TenantId, docs: readonly SearchDocument[]): Promise<void>;
  removeBatch?(
    tenantId: TenantId,
    items: readonly { entityType: string; entityId: EntityId }[],
  ): Promise<void>;
};

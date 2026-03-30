export type SearchAdapterConfig = {
  searchableFields: readonly string[];
  rankingFields?: readonly string[];
};

export type SearchDocument = {
  entityType: string;
  entityId: number;
  weight: number;
  fields: Record<string, unknown>;
};

export type SearchResult = {
  entityType: string;
  entityId: number;
};

export type SearchOptions = {
  limit?: number;
  filterType?: string;
};

export type SearchAdapter = {
  configure(tenantId: number, config: SearchAdapterConfig): Promise<void>;
  index(tenantId: number, doc: SearchDocument): Promise<void>;
  search(tenantId: number, query: string, options?: SearchOptions): Promise<SearchResult[]>;
  remove(tenantId: number, entityType: string, entityId: number): Promise<void>;
};

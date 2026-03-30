export type SearchAdapterConfig = {
  searchableFields: readonly string[];
  rankingFields?: readonly string[];
};

export type GlobalSearchResult = {
  entity: string;
  ids: number[];
};

export type SearchAdapter = {
  configure(entity: string, config: SearchAdapterConfig): Promise<void>;
  index(entity: string, id: number, fields: Record<string, unknown>): Promise<void>;
  search(entity: string, query: string, options?: { limit?: number }): Promise<number[]>;
  globalSearch(
    query: string,
    entities: readonly string[],
    options?: { limit?: number },
  ): Promise<GlobalSearchResult[]>;
  remove(entity: string, id: number): Promise<void>;
};

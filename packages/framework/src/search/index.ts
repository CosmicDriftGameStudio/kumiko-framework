// Meilisearch-Adapter lebt im Sub-Path-Export `@cosmicdrift/kumiko-framework/search/meilisearch`.
// Damit lädt der Main-Barrel keinen Meilisearch-Client beim bloßen Anfassen
// von SearchAdapter-Types. Apps die Meilisearch nicht nutzen, ziehen den
// Client-Code nicht mit rein.
export { createInMemorySearchAdapter } from "./in-memory-adapter";
export type {
  ReindexEntityFailure,
  ReindexEntityOptions,
  ReindexEntityResult,
} from "./reindex-entity";
export { reindexEntity } from "./reindex-entity";
export type {
  SearchAdapter,
  SearchAdapterConfig,
  SearchDocument,
  SearchOptions,
  SearchResult,
} from "./types";

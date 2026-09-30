// Meilisearch-Adapter lebt im Sub-Path-Export `@cosmicdrift/kumiko-framework/search/meilisearch`.
// Damit lädt der Main-Barrel keinen Meilisearch-Client beim bloßen Anfassen
// von SearchAdapter-Types. Apps die Meilisearch nicht nutzen, ziehen den
// Client-Code nicht mit rein.
export { deriveSearchAdapterConfig } from "./derive-search-adapter-config.js";
export { createInMemorySearchAdapter } from "./in-memory-adapter.js";
export { purgeSearchDocumentsForSubject } from "./purge-subject.js";
export type {
  ReindexEntityFailure,
  ReindexEntityOptions,
  ReindexEntityResult,
} from "./reindex-entity.js";
export { reindexEntity } from "./reindex-entity.js";
export type {
  SearchAdapter,
  SearchAdapterConfig,
  SearchDocument,
  SearchOptions,
  SearchResult,
} from "./types.js";

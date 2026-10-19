// Meilisearch-Adapter lebt im Sub-Path-Export `@cosmicdrift/kumiko-framework/search/meilisearch`.
// Damit lädt der Main-Barrel keinen Meilisearch-Client beim bloßen Anfassen
// von SearchAdapter-Types. Apps die Meilisearch nicht nutzen, ziehen den
// Client-Code nicht mit rein.
export {
  collectSearchableFieldNames,
  configureTenantSearchIndex,
} from "./configure-tenant-index.ts";
export { deriveSearchAdapterConfig } from "./derive-search-adapter-config.ts";
export { createInMemorySearchAdapter } from "./in-memory-adapter.ts";
export { purgeSearchDocumentsForSubject } from "./purge-subject.ts";
export type {
  ReindexEntityFailure,
  ReindexEntityOptions,
  ReindexEntityResult,
} from "./reindex-entity.ts";
export { reindexEntity } from "./reindex-entity.ts";
export type {
  SearchAdapter,
  SearchAdapterConfig,
  SearchDocument,
  SearchOptions,
  SearchResult,
} from "./types.ts";

// The Meilisearch adapter is exposed through the subpath export
// `@cosmicdrift/kumiko-framework/search/meilisearch`. This keeps the main barrel from loading a
// Meilisearch client when consumers only use SearchAdapter types, so apps that do not use
// Meilisearch do not pull in the client code.
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

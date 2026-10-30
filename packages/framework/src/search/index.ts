// The Meilisearch adapter is exposed through the subpath export
// `@cosmicdrift/kumiko-framework/search/meilisearch`. This keeps the main barrel from loading a
// Meilisearch client when consumers only use SearchAdapter types, so apps that do not use
// Meilisearch do not pull in the client code.
export { buildSearchSnippet, type SearchSnippet } from "./build-search-snippet.ts";
export { collectSearchableFieldNames } from "./configure-tenant-index.ts";
export { createInMemorySearchAdapter } from "./in-memory-adapter.ts";
export { isEntitySearchable } from "./is-entity-searchable.ts";
export { purgeSearchDocumentsForSubject } from "./purge-subject.ts";
export { reindexEntity } from "./reindex-entity.ts";
export {
  type ReindexTenantsSearchOptions,
  type ReindexTenantsSearchResult,
  reindexTenantsSearch,
} from "./reindex-tenants-search.ts";
export type {
  SearchAdapter,
  SearchAdapterConfig,
} from "./types.ts";

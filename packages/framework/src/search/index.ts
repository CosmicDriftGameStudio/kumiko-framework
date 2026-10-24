// The Meilisearch adapter is exposed through the subpath export
// `@cosmicdrift/kumiko-framework/search/meilisearch`. This keeps the main barrel from loading a
// Meilisearch client when consumers only use SearchAdapter types, so apps that do not use
// Meilisearch do not pull in the client code.
export { createInMemorySearchAdapter } from "./in-memory-adapter.ts";
export { purgeSearchDocumentsForSubject } from "./purge-subject.ts";
export { reindexEntity } from "./reindex-entity.ts";
export type {
  SearchAdapter,
  SearchAdapterConfig,
} from "./types.ts";

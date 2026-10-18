// Public API of the document-ingest-foundation bundled-feature.

export { documentIngestAggregateId } from "./aggregate-id.ts";
export {
  type DocumentExtractMeta,
  documentExtractEntity,
  documentExtractsTable,
  type IngestPage,
} from "./entity.ts";
export {
  DOCUMENT_INGEST_AGGREGATE_TYPE,
  DOCUMENT_INGEST_REQUESTED_EVENT_QN,
  DOCUMENT_INGEST_REQUESTED_EVENT_SHORT,
  DOCUMENT_INGEST_SKIPPED_EVENT_QN,
  DOCUMENT_INGEST_SKIPPED_EVENT_SHORT,
  type DocumentIngestRequestedPayload,
  type DocumentIngestSkippedPayload,
  documentIngestRequestedPayloadSchema,
  documentIngestSkippedPayloadSchema,
} from "./events.ts";
export { createDocumentIngestFoundationFeature } from "./feature.ts";
export { readIngestPages, writeIngestPages } from "./pages.ts";
export {
  type DocumentIngestProviderOptions,
  documentIngestProviderOptionsSchema,
  documentIngestProviderTrigger,
  EXT_DOCUMENT_INGEST_PROVIDER,
  listIngestibleMimeTypes,
  type ResolvedDocumentIngestProvider,
  resolveDocumentIngestProviders,
} from "./providers.ts";
export {
  type DocumentExtractWriteResult,
  writeDocumentExtractForLiveFileRef,
} from "./write-document-extract.ts";

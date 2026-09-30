// Public API of the document-ingest-foundation bundled-feature.

export {
  type DocumentExtractMeta,
  documentExtractEntity,
  documentExtractsTable,
  type IngestPage,
} from "./entity.js";
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
} from "./events.js";
export { documentIngestFoundationFeature } from "./feature.js";
export { readIngestPages, writeIngestPages } from "./pages.js";
export {
  type DocumentIngestProviderOptions,
  documentIngestProviderOptionsSchema,
  documentIngestProviderTrigger,
  EXT_DOCUMENT_INGEST_PROVIDER,
  listIngestibleMimeTypes,
  type ResolvedDocumentIngestProvider,
  resolveDocumentIngestProviders,
} from "./providers.js";
export {
  type DocumentExtractWriteResult,
  writeDocumentExtractForLiveFileRef,
} from "./write-document-extract.js";

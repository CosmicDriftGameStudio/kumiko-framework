// Public API of the document-ingest-foundation bundled-feature.

export {
  type DocumentExtractMeta,
  documentExtractEntity,
  documentExtractsTable,
  type IngestPage,
} from "./entity";
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
} from "./events";
export { documentIngestFoundationFeature } from "./feature";
export { readIngestPages, writeIngestPages } from "./pages";
export {
  type DocumentIngestProviderOptions,
  documentIngestProviderOptionsSchema,
  documentIngestProviderTrigger,
  EXT_DOCUMENT_INGEST_PROVIDER,
  listIngestibleMimeTypes,
  type ResolvedDocumentIngestProvider,
  resolveDocumentIngestProviders,
} from "./providers";
export {
  type DocumentExtractWriteResult,
  writeDocumentExtractForLiveFileRef,
} from "./write-document-extract";

// Public API of the document-ingest-foundation bundled-feature.

export { type DocumentExtractMeta, documentExtractEntity, type IngestPage } from "./entity";
export {
  DOCUMENT_INGEST_AGGREGATE_TYPE,
  DOCUMENT_INGEST_REQUESTED_EVENT_QN,
  DOCUMENT_INGEST_REQUESTED_EVENT_SHORT,
  type DocumentIngestRequestedPayload,
  documentIngestRequestedPayloadSchema,
} from "./events";
export { documentIngestFoundationFeature } from "./feature";

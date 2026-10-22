import * as z from "zod";

// documentIngest — own aggregate-type for the ingest-request stream, one
// stream per fileRef with aggregateId derived from the fileRefId
// (documentIngestAggregateId), never the fileRefId itself: foreign events on
// the fileRef stream would break the fileRef's optimistic lock. Not backed by an r.entity;
// this is a pure saga-anchor event that the worker job (kumiko-enterprise LiteParse provider)
// subscribes to.
export const DOCUMENT_INGEST_AGGREGATE_TYPE = "document-ingest";

// Stream name of stored extract events; differs from the camelCase r.entity name
// "documentExtract", so the projection replays this stream through an extension.
export const DOCUMENT_EXTRACT_AGGREGATE_TYPE = "document-extract";

export const DOCUMENT_INGEST_REQUESTED_EVENT_SHORT = "documentIngest.requested" as const;

// Qualified name — what ctx.unsafeAppendEvent's `type` actually needs
// (r.defineEvent registers under qn(toKebab(feature), "event",
// toKebab(shortName)); appendEvent looks up the registry by QN, not the
// short name — see MSP-apply "event not registered" error otherwise).
export const DOCUMENT_INGEST_REQUESTED_EVENT_QN =
  "document-ingest-foundation:event:document-ingest-requested" as const;

export const documentIngestRequestedPayloadSchema = z.object({
  fileRefId: z.string().min(1),
  storageKey: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().min(0),
  // Which registered provider claimed this mimeType — the job-trigger
  // where-filter every provider's job routes through (documentIngestProviderTrigger).
  provider: z.string().min(1),
});
export type DocumentIngestRequestedPayload = z.infer<typeof documentIngestRequestedPayloadSchema>;

export const DOCUMENT_INGEST_SKIPPED_EVENT_SHORT = "documentIngest.skipped" as const;

export const DOCUMENT_INGEST_SKIPPED_EVENT_QN =
  "document-ingest-foundation:event:document-ingest-skipped" as const;

export const documentIngestSkippedPayloadSchema = z.object({
  fileRefId: z.string().min(1),
  storageKey: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().min(0),
  reason: z.enum(["file-too-large", "unsupported-mime-type"]),
});
export type DocumentIngestSkippedPayload = z.infer<typeof documentIngestSkippedPayloadSchema>;

// Terminal events of a document-extract stream. The QNs belong to the provider that registers
// them; the foundation only owns the shared payload shape.
export const documentExtractReadyPayloadSchema = z.object({
  documentExtractId: z.string().min(1),
  fileRefId: z.string().min(1),
});
export type DocumentExtractReadyPayload = z.infer<typeof documentExtractReadyPayloadSchema>;

export const documentExtractFailedPayloadSchema = z.object({
  documentExtractId: z.string().min(1),
  fileRefId: z.string().min(1),
  error: z.string().min(1),
});
export type DocumentExtractFailedPayload = z.infer<typeof documentExtractFailedPayloadSchema>;

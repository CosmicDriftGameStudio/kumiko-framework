import { z } from "zod";

// documentIngest — own aggregate-type for the ingest-request stream, one
// stream per fileRef (aggregateId = fileRefId). Not backed by an r.entity;
// this is a pure saga-anchor event (kumiko-framework#1497) that the Phase-2
// worker job (kumiko-enterprise LiteParse provider) subscribes to.
export const DOCUMENT_INGEST_AGGREGATE_TYPE = "document-ingest";

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
});
export type DocumentIngestRequestedPayload = z.infer<typeof documentIngestRequestedPayloadSchema>;

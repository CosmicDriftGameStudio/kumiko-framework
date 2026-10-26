import * as z from "zod";
import { senderAuthenticationFieldSchema } from "../sender-auth.ts";
import { inboundContentPayloadShape } from "./message-content.ts";

// =============================================================================
// Input schema — the normalized provider output (RawInboundMessage,
// types.ts) plus the envelope (accountId/providerName/providerCursor). The
// original and attachments ride in-process as bytes and are persisted to file
// storage here; the event itself stays blob-free (references only).
// =============================================================================

export const ingestMessageSchema = z.object({
  accountId: z.uuid(),
  /** Scope inherited from the account — the supervisor knows the
   *  MailAccountRecord and passes ownerUserId through. */
  ownerUserId: z.string().max(36).nullable(),
  providerName: z.string().min(1).max(50),
  /** Provider-native Message-ID — idempotency anchor with accountId. */
  providerMessageId: z.string().min(1).max(500),
  /** RFC-5322 Message-ID without <>; null → deterministic fallback. */
  messageIdHeader: z.string().min(1).max(500).nullable(),
  providerThreadId: z.string().min(1).max(500).nullable(),
  /** References/In-Reply-To chain, oldest first. */
  references: z.array(z.string().min(1).max(500)).max(200),
  from: z.string().min(1).max(2000),
  to: z.array(z.string().max(2000)).max(200),
  cc: z.array(z.string().max(2000)).max(200),
  subject: z.string().max(4000),
  snippet: z.string().max(4000),
  receivedAtIso: z.string().min(1),
  /** From the app's storeBody hook; empty lets the handler store the original itself. */
  bodyRef: z.string().max(500),
  scope: z.string().min(1).max(200),
  /** Cursor snapshot at ingest time — used for debugging/replay and stored in
   *  metadata.headers, never in the payload. */
  providerCursor: z.string().max(2000),
  senderAuthentication: senderAuthenticationFieldSchema.optional(),
  ...inboundContentPayloadShape,
});
export type IngestMessagePayload = z.infer<typeof ingestMessageSchema>;

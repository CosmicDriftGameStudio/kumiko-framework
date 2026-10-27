// attach-message-content — stores the content of a message that was imported as snippet only, after
// the supervisor re-downloaded it. Appends one content-fetched event on the existing stream; no
// thread rollup, no new message row. A header-only import from quarantine takes its content the
// same way. Nested dispatches skip the pre-transaction upload and store in their own transaction.

import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { ConflictError, failNotFound, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import type {
  BeforeTransactionContext,
  BeforeTransactionResult,
  WriteResult,
} from "@cosmicdrift/kumiko-types/handlers";
import * as z from "zod";
import { inboundMessageAggregateId } from "../aggregate-id.ts";
import {
  INBOUND_MESSAGE_AGGREGATE_TYPE,
  INBOUND_MESSAGE_CONTENT_FETCHED_EVENT_QN,
  INBOUND_MESSAGE_RECEIVED_EVENT_QN,
  type InboundContentState,
  type InboundMessageContentFetchedEventPayload,
} from "../events.ts";
import { inboundMessagesProjectionTable } from "../projection.ts";
import {
  finalizePreparedContent,
  type PreparedInboundContent,
  prepareInboundContent,
} from "./ingest-message-prepare.ts";
import {
  contentStateOf,
  encryptMessageBodyText,
  inboundContentPayloadShape,
  MESSAGE_LOCK_NAMESPACE,
  storeInboundMessageContent,
} from "./message-content.ts";

export const attachMessageContentSchema = z.object({
  accountId: z.uuid(),
  providerMessageId: z.string().min(1).max(500),
  /** "unavailable" is terminal: the mail is gone from the server or cannot be parsed. */
  outcome: z.enum(["fetched", "unavailable"]),
  ...inboundContentPayloadShape,
});

type AttachMessageContentPayload = z.infer<typeof attachMessageContentSchema>;

const COMPLETE: InboundContentState = "complete";

function hasContentAlready(events: readonly { type: string; payload: unknown }[]): boolean {
  return events.some((e) => {
    if (e.type === INBOUND_MESSAGE_CONTENT_FETCHED_EVENT_QN) return true;
    const state = z.object({ contentState: z.string() }).safeParse(e.payload);
    return state.success && state.data.contentState === COMPLETE;
  });
}

const receivedOwnerSchema = z.object({ ownerUserId: z.string().nullable() });

function ownerUserIdOfStream(events: readonly { type: string; payload: unknown }[]): string | null {
  const received = events.find((e) => e.type === INBOUND_MESSAGE_RECEIVED_EVENT_QN);
  const parsed = receivedOwnerSchema.safeParse(received?.payload);
  return parsed.success ? parsed.data.ownerUserId : null;
}

// Read before the transaction, so it can only skip work: a row that already shows attached content
// spares parallel refetches the upload. The event check under the message lock stays authoritative.
async function showsAttachedContent(
  db: BeforeTransactionContext["db"],
  messageAggId: string,
): Promise<boolean> {
  const [row] = await db.selectMany(
    inboundMessagesProjectionTable,
    { id: messageAggId },
    { fields: ["contentState", "contentUnavailableReason"] },
  );
  if (row === undefined) return false;
  if (row["contentState"] === COMPLETE) return true;
  // "quarantined" is the header-only import still waiting for its content.
  return row["contentState"] === "unavailable" && row["contentUnavailableReason"] !== "quarantined";
}

function contentInputOf(payload: AttachMessageContentPayload, messageAggId: string) {
  return {
    accountId: payload.accountId,
    messageAggId,
    bodyRef: "",
    rawMime: payload.rawMime,
    bodyHtml: payload.bodyHtml,
    attachments: payload.attachments,
    skippedAttachments: payload.skippedAttachments,
  };
}

async function contentEventPayloadOf(
  payload: AttachMessageContentPayload,
  content: Awaited<ReturnType<typeof storeInboundMessageContent>> | undefined,
  tenantId: Parameters<typeof encryptMessageBodyText>[0],
  messageAggId: string,
  ownerUserId: string | null,
): Promise<InboundMessageContentFetchedEventPayload> {
  const fetched = payload.outcome === "fetched";
  return {
    accountId: payload.accountId,
    ownerUserId,
    bodyRef: content?.bodyRef ?? "",
    bodyText: await encryptMessageBodyText(tenantId, messageAggId, fetched ? payload.bodyText : ""),
    bodyTextTruncated: fetched && payload.bodyTextTruncated,
    attachmentFileIds: content?.attachmentFileIds ?? [],
    skippedAttachments: content?.skippedAttachments ?? [],
    contentState: content
      ? contentStateOf({
          bodyText: payload.bodyText,
          hasOriginal: payload.rawMime !== undefined || payload.bodyHtml !== undefined,
          contentStorage: content.contentStorage,
        })
      : "unavailable",
    contentUnavailableReason: !content
      ? "gone_from_server"
      : content.contentStorage === "unavailable"
        ? "no_file_storage"
        : null,
  };
}

export const attachMessageContentHandler = defineWriteHandler({
  name: "attach-message-content",
  schema: attachMessageContentSchema,
  access: { roles: ["SystemAdmin"] },
  agent: { expose: false },
  description:
    "Stores the full text, original and attachments of an already imported snippet-only or quarantined mail, or marks its content as unavailable when the provider no longer has it; called by the sync supervisor, a second call for the same mail is a no-op.",
  beforeTransactionWhenNested: "skip",
  beforeTransaction: async (
    event,
    ctx,
  ): Promise<BeforeTransactionResult<PreparedInboundContent | undefined>> => {
    const { payload } = event;
    if (payload.outcome !== "fetched") return { isSuccess: true, data: undefined };
    const messageAggId = inboundMessageAggregateId(payload.accountId, payload.providerMessageId);
    if (await showsAttachedContent(ctx.db, messageAggId))
      return { isSuccess: true, data: undefined };
    return prepareInboundContent(ctx, contentInputOf(payload, messageAggId));
  },
  handler: async (event, ctx): Promise<WriteResult<{ readonly duplicate: boolean }>> => {
    const { payload } = event;
    const prepared: PreparedInboundContent | undefined = event.prepared;
    const tenantId = event.user.tenantId;
    const messageAggId = inboundMessageAggregateId(payload.accountId, payload.providerMessageId);

    await ctx.db.advisoryXactLock(MESSAGE_LOCK_NAMESPACE, messageAggId);
    const events = await ctx.events.load(messageAggId);
    if (events.length === 0) return failNotFound("inbound-message", messageAggId);
    if (hasContentAlready(events)) {
      return { isSuccess: true as const, data: { duplicate: true as const } };
    }

    const content =
      payload.outcome !== "fetched"
        ? undefined
        : prepared
          ? await finalizePreparedContent(ctx, prepared)
          : await storeInboundMessageContent(ctx, contentInputOf(payload, messageAggId));
    const eventPayload = await contentEventPayloadOf(
      payload,
      content,
      tenantId,
      messageAggId,
      ownerUserIdOfStream(events),
    );
    const appended = await ctx.events.tryAppend({
      aggregateId: messageAggId,
      aggregateType: INBOUND_MESSAGE_AGGREGATE_TYPE,
      type: INBOUND_MESSAGE_CONTENT_FETCHED_EVENT_QN,
      payload: eventPayload,
      headers: { providerMessageId: payload.providerMessageId, outcome: payload.outcome },
    });
    // Losing the version race must roll back the stored attachments instead of reporting success.
    if (!appended.ok) {
      return writeFailure(
        new ConflictError({ message: "inbound message content changed concurrently" }),
      );
    }
    return { isSuccess: true as const, data: { duplicate: false as const } };
  },
});

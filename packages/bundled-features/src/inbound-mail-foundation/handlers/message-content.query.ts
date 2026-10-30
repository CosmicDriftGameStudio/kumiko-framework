// message:content — the decrypted full text, attachment ids and content state of one message.
// message:list deliberately omits all of it so inbox lists stay small.

import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { HandlerContext, QueryHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { parseJsonOrThrow } from "@cosmicdrift/kumiko-framework/utils";
import * as z from "zod";
import { INBOUND_MESSAGE_PII_FIELDS } from "../entities.ts";
import {
  INBOUND_CONTENT_STATES,
  INBOUND_CONTENT_UNAVAILABLE_REASONS,
  type InboundContentState,
  type InboundContentUnavailableReason,
  skippedAttachmentSchema,
} from "../events.ts";
import type { InboundMailRoles } from "../mail-roles.ts";
import { inboundMessagesProjectionTable } from "../projection.ts";
import { type SenderAuthentication, senderAuthenticationFieldSchema } from "../sender-auth.ts";
import type { SkippedInboundAttachment } from "../types.ts";
import { isVisibleToCaller } from "./scope-visibility.ts";

export type InboundMessageContent = {
  readonly messageId: string;
  readonly bodyText: string;
  readonly bodyTextTruncated: boolean;
  /** Sanitized HTML, null when the mail has none; readers show bodyText then. */
  readonly bodyHtml: string | null;
  readonly bodyRef: string;
  readonly attachmentFileIds: readonly string[];
  readonly skippedAttachments: readonly SkippedInboundAttachment[];
  readonly contentState: InboundContentState;
  readonly contentUnavailableReason: InboundContentUnavailableReason | null;
  /** null = no trustworthy statement; see isSenderAuthenticated. */
  readonly senderAuthentication: SenderAuthentication | null;
};

const messageContentSchema = z.object({ messageId: z.uuid() }).strict();
const fileIdsSchema = z.array(z.uuid());
const skippedListSchema = z.array(skippedAttachmentSchema);

// Columns hold JSON text (nullable JSON stays text); rows from before the columns read as empty.
function parseJsonColumn<T>(raw: unknown, schema: z.ZodType<T>, fallback: T): T {
  if (typeof raw !== "string" || raw === "") return fallback;
  return schema.parse(parseJsonOrThrow(raw, "inbound message content column"));
}

function contentStateOfRow(raw: unknown): InboundContentState {
  return INBOUND_CONTENT_STATES.find((state) => state === raw) ?? "snippet";
}

// Same visibility and decryption as the query, for server-side consumers (apps).
export async function loadInboundMessageContent(
  ctx: Pick<HandlerContext, "db" | "user">,
  messageId: string,
): Promise<InboundMessageContent | null> {
  const row = await ctx.db.fetchOne(inboundMessagesProjectionTable, { id: messageId });
  if (!row || !isVisibleToCaller(row, ctx.user)) return null;
  const piiKms = configuredPiiSubjectKms();
  const readable = piiKms
    ? await decryptPiiFieldValues(row, INBOUND_MESSAGE_PII_FIELDS, piiKms, {
        requestId: `inbound-mail-foundation:message-content:${ctx.user.tenantId}`,
      })
    : row;
  const bodyText = readable["bodyText"];
  return {
    messageId,
    bodyText: typeof bodyText === "string" ? bodyText : "",
    bodyTextTruncated: row["bodyTextTruncated"] === true,
    bodyHtml: typeof readable["bodyHtml"] === "string" ? readable["bodyHtml"] : null,
    bodyRef: typeof row["bodyRef"] === "string" ? row["bodyRef"] : "",
    attachmentFileIds: fileIdsSchema.parse(row["attachmentFileIds"] ?? []),
    skippedAttachments: parseJsonColumn(row["skippedAttachments"], skippedListSchema, []),
    contentState: contentStateOfRow(row["contentState"]),
    contentUnavailableReason:
      INBOUND_CONTENT_UNAVAILABLE_REASONS.find(
        (reason) => reason === row["contentUnavailableReason"],
      ) ?? null,
    senderAuthentication: parseJsonColumn(
      row["senderAuthentication"],
      senderAuthenticationFieldSchema,
      null,
    ),
  };
}

export function createMessageContentQuery({ memberRoles }: InboundMailRoles): QueryHandlerDef {
  return {
    name: "message:content",
    schema: messageContentSchema,
    access: { roles: [...memberRoles] },
    agent: { expose: false },
    description:
      "Returns the full decrypted text, the attachment file ids, the skipped attachments and the content state (complete, snippet or unavailable) of one received mail, or null when it does not exist or belongs to a personal mailbox the caller may not see; use it to read a mail beyond its snippet.",
    handler: async (query, ctx) => {
      const { messageId } = messageContentSchema.parse(query.payload);
      return loadInboundMessageContent(ctx, messageId);
    },
  };
}

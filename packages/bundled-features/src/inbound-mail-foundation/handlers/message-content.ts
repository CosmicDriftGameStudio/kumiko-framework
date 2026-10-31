// Content persistence shared by ingest-message and attach-message-content: the original
// message and the attachments go to file storage, the event only carries references.

import {
  configuredPiiSubjectKms,
  encryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { HandlerContext, Registry } from "@cosmicdrift/kumiko-framework/engine";
import {
  configuredMaxUploadBytes,
  createFileRefFromBytes,
  type FileContext,
} from "@cosmicdrift/kumiko-framework/files";
import * as z from "zod";
import { INBOUND_MESSAGE_PII_FIELDS, inboundMessageEntity } from "../entities.ts";
import {
  INBOUND_MESSAGE_AGGREGATE_TYPE,
  type InboundContentState,
  skippedAttachmentSchema,
} from "../events.ts";
import {
  INBOUND_ATTACHMENT_MAX_BYTES,
  INBOUND_BODY_HTML_MAX_CHARS,
  INBOUND_BODY_TEXT_MAX_CHARS,
  INBOUND_RAW_MIME_MAX_BYTES,
  INBOUND_SKIPPED_ATTACHMENTS_MAX_COUNT,
} from "../normalize-inbound-message.ts";
import type { RawInboundAttachment, SkippedInboundAttachment } from "../types.ts";

// Bytes only travel in-process (system dispatch); no JSON request can carry a Uint8Array.
export const inboundContentPayloadShape = {
  bodyText: z.string().max(INBOUND_BODY_TEXT_MAX_CHARS).default(""),
  bodyTextTruncated: z.boolean().default(false),
  rawMime: z
    .instanceof(Uint8Array)
    .refine((bytes) => bytes.byteLength <= INBOUND_RAW_MIME_MAX_BYTES)
    .optional(),
  bodyHtml: z.string().max(INBOUND_BODY_HTML_MAX_CHARS).optional(),
  attachments: z
    .array(
      z.object({
        fileName: z.string().max(255),
        mimeType: z.string().max(255),
        data: z.instanceof(Uint8Array),
      }),
    )
    .max(50)
    .optional(),
  skippedAttachments: z.array(skippedAttachmentSchema).max(200).optional(),
};

export type InboundContentInput = {
  readonly accountId: string;
  readonly messageAggId: string;
  /** From the app's storeBody hook; wins over the default storage. */
  readonly bodyRef: string;
  readonly rawMime?: Uint8Array | undefined;
  readonly bodyHtml?: string | undefined;
  readonly attachments?: readonly RawInboundAttachment[] | undefined;
  readonly skippedAttachments?: readonly SkippedInboundAttachment[] | undefined;
};

export type StoredInboundContent = {
  readonly bodyRef: string;
  readonly attachmentFileIds: string[];
  readonly skippedAttachments: SkippedInboundAttachment[];
  /** "unavailable" when something had to be stored but the dispatcher has no file storage. */
  readonly contentStorage: "stored" | "unavailable";
};

type ContentContext = Pick<HandlerContext, "db" | "services" | "registry" | "user">;

// Deterministic, so a re-ingest after a rollback overwrites the same object instead of orphaning one.
// Same keyspace the retention sweep deletes from (createFileProviderForTenant).
export function inboundMessageBodyKey(
  tenantId: string,
  accountId: string,
  messageAggId: string,
  extension: "eml" | "html",
): string {
  return `${tenantId}/inbound-mail/${accountId}/${messageAggId}.${extension}`;
}

export type OriginalToStore = {
  readonly data: Uint8Array;
  readonly extension: "eml" | "html";
  readonly mimeType: string;
};

export function originalOf(input: InboundContentInput): OriginalToStore | undefined {
  if (input.rawMime !== undefined) {
    return { data: input.rawMime, extension: "eml", mimeType: "message/rfc822" };
  }
  if (input.bodyHtml === undefined) return undefined;
  return {
    data: new TextEncoder().encode(input.bodyHtml),
    extension: "html",
    mimeType: "text/html",
  };
}

// The mail size limit is the cap; an app that configured a smaller upload limit keeps it, but the
// 10 MB default of createFileRefFromBytes must not cut a 25 MB mail attachment that was accepted above.
export function inboundAttachmentMaxSize(registry: Registry): number {
  return Math.min(
    INBOUND_ATTACHMENT_MAX_BYTES,
    configuredMaxUploadBytes(registry) ?? INBOUND_ATTACHMENT_MAX_BYTES,
  );
}

/** Binds an attachment fileRef to the mail row, so the file guard uses the mail's visibility. */
export function inboundAttachmentTarget(messageAggId: string) {
  return {
    entityType: INBOUND_MESSAGE_AGGREGATE_TYPE,
    entityId: messageAggId,
    fieldName: "attachmentFileIds",
  } as const;
}

export function needsFileStorage(input: InboundContentInput): boolean {
  const hasOriginal = input.rawMime !== undefined || input.bodyHtml !== undefined;
  return (input.attachments ?? []).length > 0 || (input.bodyRef === "" && hasOriginal);
}

/** What a dispatcher without file storage makes of the content: nothing is stored, attachments are skipped. */
export function contentWithoutFileStorage(input: InboundContentInput): StoredInboundContent {
  const skipped = [...(input.skippedAttachments ?? [])];
  for (const attachment of input.attachments ?? []) {
    skipped.push({
      mimeType: attachment.mimeType,
      size: attachment.data.byteLength,
      reason: "no_file_storage",
    });
  }
  return {
    bodyRef: input.bodyRef,
    attachmentFileIds: [],
    skippedAttachments: skipped.slice(0, INBOUND_SKIPPED_ATTACHMENTS_MAX_COUNT),
    contentStorage: needsFileStorage(input) ? "unavailable" : "stored",
  };
}

async function storeOriginal(
  files: FileContext,
  tenantId: string,
  input: InboundContentInput,
): Promise<string> {
  const original = originalOf(input);
  if (!original) return "";
  const key = inboundMessageBodyKey(
    tenantId,
    input.accountId,
    input.messageAggId,
    original.extension,
  );
  await files.ref(key).write(original.data, original.mimeType);
  return key;
}

// Nested dispatches (an app handler calling ingest-message) have no pre-transaction phase, so the
// bytes are written here, inside the caller's transaction.
export async function storeInboundMessageContent(
  ctx: ContentContext,
  input: InboundContentInput,
): Promise<StoredInboundContent> {
  const { files } = ctx.services;
  if (!files) return contentWithoutFileStorage(input);

  const skipped = [...(input.skippedAttachments ?? [])];
  const bodyRef =
    input.bodyRef !== "" ? input.bodyRef : await storeOriginal(files, ctx.user.tenantId, input);
  const attachmentFileIds: string[] = [];
  const maxSize = inboundAttachmentMaxSize(ctx.registry);
  for (const attachment of input.attachments ?? []) {
    const created = await createFileRefFromBytes(ctx, {
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      data: attachment.data,
      attachTo: inboundAttachmentTarget(input.messageAggId),
      maxSize,
    });
    if (created.isSuccess) {
      attachmentFileIds.push(created.data.id);
    } else {
      skipped.push({
        mimeType: attachment.mimeType,
        size: attachment.data.byteLength,
        reason: "rejected",
      });
    }
  }
  return {
    bodyRef,
    attachmentFileIds,
    skippedAttachments: skipped.slice(0, INBOUND_SKIPPED_ATTACHMENTS_MAX_COUNT),
    contentStorage: "stored",
  };
}

// 'inmc': serializes ingest and content attachment per message; disjoint from the thread-rollup namespace.
export const MESSAGE_LOCK_NAMESPACE = 0x696e6d63;

// Encrypts a single message PII field outside the batch encryption of ingest-message.
export async function encryptMessageBodyText(
  tenantId: string,
  messageAggId: string,
  bodyText: string,
): Promise<string> {
  const piiKms = configuredPiiSubjectKms();
  if (!piiKms) return bodyText;
  const encrypted = await encryptPiiFieldValues(
    { tenantId, bodyText },
    inboundMessageEntity,
    INBOUND_MESSAGE_PII_FIELDS,
    piiKms,
    { requestId: `inbound-mail-foundation:message-content:${messageAggId}`, tenantId },
    { tenantId, entityName: INBOUND_MESSAGE_AGGREGATE_TYPE },
  );
  return encrypted.bodyText;
}

// Same, for the sanitized HTML body (null stays null: nothing to encrypt).
export async function encryptMessageBodyHtml(
  tenantId: string,
  messageAggId: string,
  bodyHtml: string | null,
): Promise<string | null> {
  const piiKms = configuredPiiSubjectKms();
  if (!piiKms || bodyHtml === null) return bodyHtml;
  const encrypted = await encryptPiiFieldValues(
    { tenantId, bodyHtml },
    inboundMessageEntity,
    INBOUND_MESSAGE_PII_FIELDS,
    piiKms,
    { requestId: `inbound-mail-foundation:message-content:${messageAggId}`, tenantId },
    { tenantId, entityName: INBOUND_MESSAGE_AGGREGATE_TYPE },
  );
  return encrypted.bodyHtml;
}

export function contentStateOf(args: {
  readonly bodyText: string;
  readonly hasOriginal: boolean;
  readonly contentStorage: StoredInboundContent["contentStorage"];
}): InboundContentState {
  if (args.contentStorage === "unavailable") return "unavailable";
  return args.bodyText.length > 0 || args.hasOriginal ? "complete" : "snippet";
}

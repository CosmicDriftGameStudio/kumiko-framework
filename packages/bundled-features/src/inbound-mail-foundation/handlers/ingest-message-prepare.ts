// Pre-transaction half of the content storage: original and attachments are written while no
// transaction holds a connection, so a slow or failing file store never pins the database. The
// handler transaction only creates the fileRef rows (finalizePreparedContent).

import { writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import {
  createFileRefFromUploadedBytes,
  type UploadedFileBytes,
  uploadFileBytesBeforeTransaction,
} from "@cosmicdrift/kumiko-framework/files";
import type {
  BeforeTransactionContext,
  BeforeTransactionResult,
  ReservationRelease,
} from "@cosmicdrift/kumiko-types/handlers";
import { inboundMessageAggregateId } from "../aggregate-id.ts";
import { seenMessageTable } from "../entities.ts";
import { FileStorageWriteFailedError } from "../file-storage-failure.ts";
import { INBOUND_SKIPPED_ATTACHMENTS_MAX_COUNT } from "../normalize-inbound-message.ts";
import type { SkippedInboundAttachment } from "../types.ts";
import type { IngestMessagePayload } from "./ingest-message-schema.ts";
import {
  contentWithoutFileStorage,
  type InboundContentInput,
  inboundAttachmentMaxSize,
  inboundAttachmentTarget,
  inboundMessageBodyKey,
  originalOf,
  type StoredInboundContent,
} from "./message-content.ts";

export type PreparedInboundContent = {
  readonly bodyRef: string;
  readonly uploads: readonly UploadedFileBytes[];
  readonly skippedAttachments: readonly SkippedInboundAttachment[];
  readonly contentStorage: StoredInboundContent["contentStorage"];
};

export type PreparedIngest =
  | { readonly duplicate: true }
  | { readonly duplicate: false; readonly content: PreparedInboundContent };

type PrepareContext = Pick<BeforeTransactionContext, "db" | "services" | "registry" | "user">;

function storageFailure(cause: unknown) {
  return writeFailure(new FileStorageWriteFailedError(cause instanceof Error ? cause : undefined));
}

async function releaseAll(releases: readonly ReservationRelease[]): Promise<void> {
  for (const release of releases) await release();
}

// The deterministic original key is never released: a concurrent winner owns it and writing it
// again is idempotent.
export async function prepareInboundContent(
  ctx: PrepareContext,
  input: InboundContentInput,
): Promise<BeforeTransactionResult<PreparedInboundContent>> {
  const { files } = ctx.services;
  if (!files) {
    const unavailable = contentWithoutFileStorage(input);
    return {
      isSuccess: true,
      data: {
        bodyRef: unavailable.bodyRef,
        uploads: [],
        skippedAttachments: unavailable.skippedAttachments,
        contentStorage: unavailable.contentStorage,
      },
    };
  }

  let bodyRef = input.bodyRef;
  const original = originalOf(input);
  if (bodyRef === "" && original) {
    bodyRef = inboundMessageBodyKey(
      ctx.user.tenantId,
      input.accountId,
      input.messageAggId,
      original.extension,
    );
    try {
      await files.ref(bodyRef).write(original.data, original.mimeType);
    } catch (err) {
      return storageFailure(err);
    }
  }

  const uploads: UploadedFileBytes[] = [];
  const releases: ReservationRelease[] = [];
  const skipped = [...(input.skippedAttachments ?? [])];
  const maxSize = inboundAttachmentMaxSize(ctx.registry);
  for (const attachment of input.attachments ?? []) {
    let uploaded: Awaited<ReturnType<typeof uploadFileBytesBeforeTransaction>>;
    try {
      uploaded = await uploadFileBytesBeforeTransaction(ctx, {
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        data: attachment.data,
        attachTo: inboundAttachmentTarget(input.messageAggId),
        maxSize,
      });
    } catch (err) {
      await releaseAll(releases);
      return storageFailure(err);
    }
    // A rejected attachment (size, MIME) is a property of the mail, not an outage.
    if (!uploaded.isSuccess) {
      skipped.push({
        mimeType: attachment.mimeType,
        size: attachment.data.byteLength,
        reason: "rejected",
      });
      continue;
    }
    uploads.push(uploaded.data);
    if (uploaded.release) releases.push(uploaded.release);
  }
  return {
    isSuccess: true,
    data: {
      bodyRef,
      uploads,
      skippedAttachments: skipped.slice(0, INBOUND_SKIPPED_ATTACHMENTS_MAX_COUNT),
      contentStorage: "stored",
    },
    release: () => releaseAll(releases),
  };
}

/** Transaction half: creates the fileRef rows for the bytes the prepare phase wrote. */
export async function finalizePreparedContent(
  ctx: Parameters<typeof createFileRefFromUploadedBytes>[0],
  prepared: PreparedInboundContent,
): Promise<StoredInboundContent> {
  const attachmentFileIds: string[] = [];
  const skipped = [...prepared.skippedAttachments];
  for (const upload of prepared.uploads) {
    const created = await createFileRefFromUploadedBytes(ctx, upload);
    if (created.isSuccess) attachmentFileIds.push(created.data.id);
    else skipped.push({ mimeType: upload.mimeType, size: upload.size, reason: "rejected" });
  }
  return {
    bodyRef: prepared.bodyRef,
    attachmentFileIds,
    skippedAttachments: skipped.slice(0, INBOUND_SKIPPED_ATTACHMENTS_MAX_COUNT),
    contentStorage: prepared.contentStorage,
  };
}

/** Dedup read first: a duplicate uploads nothing. The in-transaction dedup stays the correctness anchor. */
export async function prepareIngestMessage(
  event: { readonly payload: IngestMessagePayload },
  ctx: PrepareContext,
): Promise<BeforeTransactionResult<PreparedIngest>> {
  const { payload } = event;
  const seen = await ctx.db.selectMany(seenMessageTable, {
    accountId: payload.accountId,
    providerMessageId: payload.providerMessageId,
  });
  if (seen.length > 0) return { isSuccess: true, data: { duplicate: true } };
  const prepared = await prepareInboundContent(ctx, {
    accountId: payload.accountId,
    messageAggId: inboundMessageAggregateId(payload.accountId, payload.providerMessageId),
    bodyRef: payload.bodyRef,
    rawMime: payload.rawMime,
    bodyHtml: payload.bodyHtml,
    attachments: payload.attachments,
    skippedAttachments: payload.skippedAttachments,
  });
  if (!prepared.isSuccess) return prepared;
  return {
    isSuccess: true,
    data: { duplicate: false, content: prepared.data },
    ...(prepared.release && { release: prepared.release }),
  };
}

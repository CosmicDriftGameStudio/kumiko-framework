import {
  access,
  defineWriteHandler,
  type HandlerContext,
  type SessionUser,
} from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import {
  createFileRefFromUploadedBytes,
  type UploadedFileBytes,
  uploadFileBytesBeforeTransaction,
} from "@cosmicdrift/kumiko-framework/files";
import type { BeforeTransactionResult } from "@cosmicdrift/kumiko-types/handlers";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { unprocessable } from "../../shared/index.ts";
import { inboundItemAggregateId } from "../aggregate-id.ts";
import { CONNECTOR_STATUS, ConnectorErrors } from "../constants.ts";
import { connectorExecutor } from "../schema/connector.ts";
import { inboundItemExecutor } from "../schema/inbound-item.ts";

export const ReceiveFileSchema = z.object({
  connectorId: z.uuid(),
  relativePath: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  sourceModifiedAt: z.string().min(1),
  mimeType: z.string().min(1).max(200),
  maxBytes: z.number().int().positive(),
  // Raw bytes stay in-process: a handler payload is JSON on the wire and bytes would not survive it.
  data: z.instanceof(Uint8Array),
});

type ReceiveFilePayload = z.infer<typeof ReceiveFileSchema>;

function fileNameOf(relativePath: string): string {
  return relativePath.slice(relativePath.lastIndexOf("/") + 1);
}

async function itemExists(
  payload: ReceiveFilePayload,
  user: SessionUser,
  db: HandlerContext["db"],
): Promise<boolean> {
  const itemId = inboundItemAggregateId(payload.connectorId, payload.sha256, payload.relativePath);
  return Boolean(await inboundItemExecutor.detail({ id: itemId }, user, db));
}

// Duplicate is a success with `duplicate: true`: a satellite that retries after a lost response
// must end up with the same item, not an error.
export const receiveFileWrite = defineWriteHandler({
  name: "receive-file",
  schema: ReceiveFileSchema,
  access: { roles: access.system },
  agent: { expose: false },
  beforeTransactionWhenNested: "skip",
  description:
    "Internal: stores one delivered file as a file reference plus an inbound item, keyed by connector, hash and path so the same file again is the same item.",
  // ponytail: a crash between the byte write and the commit leaves an orphan blob without FileRef; the files upload-ledger sweep removes it after its grace period.
  // No entityType on the upload: the pending-upload sweep only touches uploads naming a form field, so these FileRefs are never swept.
  // The bytes are written before the transaction so a slow file store never holds a connection;
  // a file already delivered skips the write altogether (prepared stays null).
  beforeTransaction: async (
    event,
    ctx,
  ): Promise<BeforeTransactionResult<UploadedFileBytes | null>> => {
    const { payload } = event;
    if (await itemExists(payload, event.user, ctx.db)) return { isSuccess: true, data: null };
    return uploadFileBytesBeforeTransaction(ctx, {
      fileName: fileNameOf(payload.relativePath),
      mimeType: payload.mimeType,
      data: payload.data,
      maxSize: payload.maxBytes,
    });
  },
  handler: async (event, ctx) => {
    const { payload } = event;
    const itemId = inboundItemAggregateId(
      payload.connectorId,
      payload.sha256,
      payload.relativePath,
    );
    const connector = await connectorExecutor.detail(
      { id: payload.connectorId },
      event.user,
      ctx.db,
    );
    if (!connector) return failNotFound("connector", payload.connectorId);
    if (connector.status !== CONNECTOR_STATUS.active) {
      return unprocessable(ConnectorErrors.connectorRevoked, "errors.connectors.connectorRevoked");
    }
    if (event.prepared === null || (await itemExists(payload, event.user, ctx.db))) {
      return { isSuccess: true as const, data: { id: itemId, duplicate: true } };
    }
    const fileRef =
      event.prepared === undefined
        ? undefined
        : await createFileRefFromUploadedBytes(ctx, event.prepared);
    if (fileRef === undefined) {
      return unprocessable(
        ConnectorErrors.uploadNotPrepared,
        "errors.connectors.uploadNotPrepared",
      );
    }
    if (!fileRef.isSuccess) return fileRef;
    const created = await inboundItemExecutor.create(
      {
        id: itemId,
        connectorId: payload.connectorId,
        fileRefId: fileRef.data.id,
        relativePath: payload.relativePath,
        sha256: payload.sha256,
        sizeBytes: payload.data.byteLength,
        sourceModifiedAt: Temporal.Instant.from(payload.sourceModifiedAt),
      },
      event.user,
      ctx.db,
    );
    // A parallel delivery of the same file won: the route turns this code into the duplicate answer.
    if (!created.isSuccess) return created;
    return { isSuccess: true as const, data: { id: itemId, duplicate: false } };
  },
});

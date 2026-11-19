import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  defineWriteHandler,
  type HandlerContext,
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
import { CONNECTOR_STATUS, ConnectorErrors, MAX_ID_GENERATIONS } from "../constants.ts";
import { ensureFolderChain } from "../folder-chain.ts";
import { connectorExecutor } from "../schema/connector.ts";
import { inboundItemExecutor, inboundItemTable } from "../schema/inbound-item.ts";
import { deletingFolderIds, physicalStoredBytes } from "../stored-bytes.ts";

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

// An item sitting in a folder that is being deleted does not count as delivered: the sweep removes it.
// One read over every generation's id: a forgotten generation leaves no row, so a live later generation is found past the gap.
async function liveItemId(
  payload: ReceiveFilePayload,
  db: HandlerContext["db"],
): Promise<string | null> {
  const ids = Array.from({ length: MAX_ID_GENERATIONS }, (_, generation) =>
    inboundItemAggregateId(payload.connectorId, payload.sha256, payload.relativePath, generation),
  );
  const rows = await selectMany<{ id: string; folderId: string | null }>(
    db,
    inboundItemTable,
    { id: { in: ids } },
    { fields: ["id", "folderId"] },
  );
  const doomed = new Set(await deletingFolderIds(db));
  const live = new Set(
    rows.filter((row) => row.folderId === null || !doomed.has(row.folderId)).map((row) => row.id),
  );
  return ids.find((id) => live.has(id)) ?? null;
}

// Duplicate is a success with `duplicate: true`: a satellite that retries after a lost response
// must end up with the same item, not an error.
export function createReceiveFileWrite(maxStoredBytes: number) {
  return defineWriteHandler({
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
      if ((await liveItemId(payload, ctx.db)) !== null) {
        return { isSuccess: true, data: null };
      }
      // ponytail: sum then store without a lock, so parallel uploads can overshoot the quota by their combined size; the per-file cap and the upload rate limit bound that
      if ((await physicalStoredBytes(ctx.db)) + payload.data.byteLength > maxStoredBytes) {
        return unprocessable(
          ConnectorErrors.storageQuotaExceeded,
          "errors.connectors.storageQuotaExceeded",
        );
      }
      return uploadFileBytesBeforeTransaction(ctx, {
        // Customer data the satellite can deliver again, so it stays out of the offsite backup.
        backup: false,
        fileName: fileNameOf(payload.relativePath),
        mimeType: payload.mimeType,
        data: payload.data,
        maxSize: payload.maxBytes,
      });
    },
    handler: async (event, ctx) => {
      const { payload } = event;
      const connector = await connectorExecutor.detail(
        { id: payload.connectorId },
        event.user,
        ctx.db,
      );
      if (!connector) return failNotFound("connector", payload.connectorId);
      if (connector.status !== CONNECTOR_STATUS.active) {
        return unprocessable(
          ConnectorErrors.connectorRevoked,
          "errors.connectors.connectorRevoked",
        );
      }
      const liveId = await liveItemId(payload, ctx.db);
      if (liveId !== null)
        return { isSuccess: true as const, data: { id: liveId, duplicate: true } };
      // Delivered and deleted again between the byte check and here: nothing was written, the satellite sends it again.
      if (event.prepared === null) {
        return unprocessable(
          ConnectorErrors.uploadNotPrepared,
          "errors.connectors.uploadNotPrepared",
        );
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
      const folders = payload.relativePath.split("/").slice(0, -1);
      const chain = await ensureFolderChain(payload.connectorId, folders, event.user, ctx.db);
      if (!chain.isSuccess) return { isSuccess: false as const, error: chain.error };
      const doomed = new Set(await deletingFolderIds(ctx.db));
      // A forgotten item leaves its stream unusable (create conflicts, nothing to read): the next generation takes the file.
      for (let generation = 0; generation < MAX_ID_GENERATIONS; generation += 1) {
        const id = inboundItemAggregateId(
          payload.connectorId,
          payload.sha256,
          payload.relativePath,
          generation,
        );
        const existing = await inboundItemExecutor.detail({ id }, event.user, ctx.db);
        if (existing && doomed.has(String(existing["folderId"]))) continue;
        // A live item makes the create below conflict; the failure rolls this upload (and its fileRef) back.
        const created = await inboundItemExecutor.create(
          {
            id,
            connectorId: payload.connectorId,
            folderId: chain.folderId,
            fileRefId: fileRef.data.id,
            relativePath: payload.relativePath,
            sha256: payload.sha256,
            sizeBytes: payload.data.byteLength,
            sourceModifiedAt: Temporal.Instant.from(payload.sourceModifiedAt),
          },
          event.user,
          ctx.db,
        );
        if (created.isSuccess) return { isSuccess: true as const, data: { id, duplicate: false } };
        // A parallel delivery of the same file won: the route turns this code into the duplicate answer.
        if (await inboundItemExecutor.detail({ id }, event.user, ctx.db)) return created;
      }
      return unprocessable(
        ConnectorErrors.uploadNotPrepared,
        "errors.connectors.uploadNotPrepared",
      );
    },
  });
}

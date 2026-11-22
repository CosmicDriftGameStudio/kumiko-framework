import { createEventStoreExecutor, type TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { HandlerContext, Registry, SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import {
  type CreatedFileRef,
  type CreateFileRefInput,
  createFileRefFromBytes,
  FileObjectMissingError,
  fileRefEntity,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import {
  type FileRefContent,
  FileRefTooLargeError,
  fileContextForTenant,
  readFileRefContent,
} from "./read-file-ref-content.ts";

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export type GeneratedFileContext = {
  readonly db: TenantDb;
  readonly services: HandlerContext["services"];
  readonly registry: Registry;
};

type ReadFileContext = Pick<GeneratedFileContext, "db" | "services">;

// The tenant's file refs only: a caller cannot point a request at another tenant's file.
export async function readTenantFile(
  ctx: ReadFileContext,
  tenantId: string,
  fileRefId: string,
): Promise<FileRefContent | null> {
  try {
    return await readFileRefContent({
      db: ctx.db,
      filesForTenant: (ownerTenantId) => fileContextForTenant(ctx, tenantId, ownerTenantId),
      fileRefId,
      allowedTenantIds: [tenantId],
      maxBytes: MAX_DOCUMENT_BYTES,
    });
  } catch (error) {
    if (error instanceof FileRefTooLargeError || error instanceof FileObjectMissingError)
      return null;
    throw error;
  }
}

const fileRefExecutor = createEventStoreExecutor(fileRefsTable, fileRefEntity, {
  entityName: "fileRef",
});

// For a stored file whose owner row was never written (a lost race, a rejected follow-up write): removes
// ref and bytes so nothing stays behind. Inside a transaction the ledger entry is not touched: a second
// connection deleting that row would wait on the lock the transaction holds.
export async function discardGeneratedFile(
  ctx: GeneratedFileContext,
  user: SessionUser,
  file: CreatedFileRef,
): Promise<void> {
  await fileRefExecutor.delete({ id: file.id }, user, ctx.db);
  await ctx.services.files?.ref(file.storageKey).delete();
}

export function storeGeneratedFile(
  ctx: GeneratedFileContext,
  user: SessionUser,
  file: {
    readonly fileName: string;
    readonly mimeType: string;
    readonly data: Uint8Array;
    readonly attachTo?: CreateFileRefInput["attachTo"];
  },
): Promise<WriteResult<CreatedFileRef>> {
  return createFileRefFromBytes({ ...ctx, user }, file);
}

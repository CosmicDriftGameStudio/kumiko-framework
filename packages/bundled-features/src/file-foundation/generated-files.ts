import {
  createEventStoreExecutor,
  selectMany,
  type TenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import {
  type HandlerContext,
  isUuid,
  type Registry,
  type SessionUser,
} from "@cosmicdrift/kumiko-framework/engine";
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

/** Stored bytes of the tenant's files without reading them; null when a file is unknown, so the caller falls back to reading. */
export async function sumTenantFileSizes(
  ctx: Pick<ReadFileContext, "db">,
  tenantId: string,
  fileRefIds: readonly string[],
): Promise<number | null> {
  if (!fileRefIds.every(isUuid)) return null;
  const rows = await selectMany<{ readonly id: string; readonly size: number | bigint | string }>(
    ctx.db,
    fileRefsTable,
    { id: { in: [...new Set(fileRefIds)] }, tenantId, isDeleted: false },
  );
  const sizeOfId = new Map(rows.map((row) => [row.id, Number(row.size)]));
  let total = 0;
  for (const id of fileRefIds) {
    const size = sizeOfId.get(id);
    if (size === undefined) return null;
    // A size that is not a number counts as too large, like in readFileRefContent.
    total += Number.isFinite(size) ? size : Number.POSITIVE_INFINITY;
  }
  return total;
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

export async function deleteFileRef(db: TenantDb, user: SessionUser, id: string): Promise<void> {
  await fileRefExecutor.delete({ id }, user, db);
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

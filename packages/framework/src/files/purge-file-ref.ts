import type { TenantDb } from "../db/tenant-db.ts";
import { deleteFileRefBytes } from "../derivatives/delete-stored-file.ts";
import type { SessionUser } from "../engine/types/index.ts";
import { getFileRefExecutor } from "./create-file-ref.ts";
import { fileRefsTable } from "./file-ref-table.ts";
import type { FileContext } from "./file-handle.ts";

export type PurgeFileRefOutcome =
  | { readonly kind: "purged" }
  | { readonly kind: "not-found" }
  | { readonly kind: "bound-elsewhere" }
  | {
      readonly kind: "left-to-cleanup";
      readonly bytesDeleted: boolean;
      readonly rowSoftDeleted: boolean;
    };

// Bytes first, because without the row nobody knows the storageKey any more. What stays behind is
// removed later by the soft-delete cleanup (purge-expired-file-ref-bytes.ts); the caller logs why.
export async function purgeFileRef(
  ctx: {
    readonly db: TenantDb;
    readonly user: SessionUser;
    readonly files: FileContext | undefined;
  },
  fileRefId: string,
  options?: { readonly entityType?: string },
): Promise<PurgeFileRefOutcome> {
  const row = await ctx.db.fetchOne(fileRefsTable, { id: fileRefId });
  if (!row) return { kind: "not-found" };
  if (options?.entityType !== undefined && row["entityType"] !== options.entityType) {
    return { kind: "bound-elsewhere" };
  }

  let bytesDeleted = false;
  if (ctx.files) {
    try {
      const failedKeys = await deleteFileRefBytes(
        ctx.files,
        { storageKey: String(row["storageKey"]) },
        "purge-file-ref",
      );
      bytesDeleted = failedKeys.length === 0;
    } catch {
      bytesDeleted = false;
    }
  }

  const executor = getFileRefExecutor();
  if (bytesDeleted) {
    const forgotten = await executor.forget({ id: fileRefId }, ctx.user, ctx.db);
    if (forgotten.isSuccess) return { kind: "purged" };
  }
  const softDeleted = await executor.delete({ id: fileRefId }, ctx.user, ctx.db);
  return {
    kind: "left-to-cleanup",
    bytesDeleted,
    rowSoftDeleted: softDeleted.isSuccess || row["isDeleted"] === true,
  };
}

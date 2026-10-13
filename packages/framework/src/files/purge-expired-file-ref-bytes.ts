import type { FileContext } from "@cosmicdrift/kumiko-types/file-handle-types";
import type { Logger } from "@cosmicdrift/kumiko-types/logger";
import { deleteMany, selectMany, type WhereObject } from "../db/query.js";
import type { TenantDb } from "../db/tenant-db.js";
import { deleteStoredFileAndDerivatives } from "../derivatives/delete-stored-file.js";

export const EXPIRED_FILE_REF_PURGE_BATCH = 500;

type PurgeLog = Pick<Logger, "warn"> | undefined;

// Deletes the bytes (original + derivatives) of expired soft-deleted fileRef rows, then the
// rows. Bytes first and fail-closed: once the row is gone nobody knows the storageKey, so a
// row whose bytes could not be removed stays and the next run retries it.
export async function purgeExpiredFileRefsWithBytes(args: {
  readonly db: TenantDb;
  readonly table: Parameters<typeof deleteMany>[1];
  readonly where: WhereObject;
  readonly files: FileContext | undefined;
  readonly log: PurgeLog;
}): Promise<void> {
  const { db, table, where, files, log } = args;
  if (!files) {
    log?.warn("[soft-delete-cleanup] no file storage available, expired fileRef rows kept");
    return;
  }
  const rows = await selectMany<{ id: string; storageKey: string }>(db, table, where, {
    orderBy: [{ col: "deletedAt", direction: "asc" }],
    limit: EXPIRED_FILE_REF_PURGE_BATCH,
  });
  const purgedIds: string[] = [];
  const store = { list: files.list, delete: (key: string) => files.ref(key).delete() };
  for (const row of rows) {
    try {
      const failedKeys = await deleteStoredFileAndDerivatives(
        row.storageKey,
        store,
        "soft-delete-cleanup:fileRef",
      );
      if (failedKeys.length === 0) {
        purgedIds.push(row.id);
        continue;
      }
      log?.warn(`[soft-delete-cleanup] bytes of fileRef ${row.id} not fully deleted, row kept`);
    } catch (err) {
      log?.warn(
        `[soft-delete-cleanup] bytes of fileRef ${row.id} not deleted, row kept: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (purgedIds.length > 0) await deleteMany(db, table, { ...where, id: { in: purgedIds } });
}

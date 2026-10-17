import type { FileContext } from "@cosmicdrift/kumiko-types/file-handle-types";
import type { Logger } from "@cosmicdrift/kumiko-types/logger";
import { deleteMany, selectMany, type WhereObject } from "../db/query.js";
import type { TenantDb } from "../db/tenant-db.js";
import { deleteStoredFileAndDerivatives } from "../derivatives/delete-stored-file.js";

export const EXPIRED_FILE_REF_PURGE_BATCH = 500;

type PurgeLog = Pick<Logger, "warn"> | undefined;
type PurgeTable = Parameters<typeof deleteMany>[1];
type ExpiredRow = { id: string; storageKey: string; deletedAt: unknown };

const PAGE_ORDER = [
  { col: "deletedAt", direction: "asc" },
  { col: "id", direction: "asc" },
] as const;

// Keyset page over (deletedAt, id): rows at the cursor's instant with a larger id first, then
// strictly later instants. `where` already bounds deletedAt by the cutoff; the later-instants
// query repeats that bound next to the cursor.
async function selectNextPage(args: {
  readonly db: TenantDb;
  readonly table: PurgeTable;
  readonly where: WhereObject;
  readonly expiredBefore: Temporal.Instant;
  readonly cursor: ExpiredRow | undefined;
  readonly pageSize: number;
}): Promise<readonly ExpiredRow[]> {
  const { db, table, where, expiredBefore, cursor, pageSize } = args;
  const options = { orderBy: PAGE_ORDER, limit: pageSize };
  if (cursor === undefined) return selectMany<ExpiredRow>(db, table, where, options);
  const sameInstant = await selectMany<ExpiredRow>(
    db,
    table,
    { ...where, deletedAt: cursor.deletedAt, id: { gt: cursor.id } },
    options,
  );
  if (sameInstant.length >= pageSize) return sameInstant;
  const later = await selectMany<ExpiredRow>(
    db,
    table,
    { ...where, deletedAt: { gt: cursor.deletedAt, lt: expiredBefore } },
    { ...options, limit: pageSize - sameInstant.length },
  );
  return [...sameInstant, ...later];
}

// Deletes the bytes (original + derivatives) of expired soft-deleted fileRef rows, then the
// rows. Bytes first and fail-closed: once the row is gone nobody knows the storageKey, so a
// row whose bytes could not be removed stays and the next run retries it. A run walks the
// expired rows page by page along (deletedAt, id), so rows that keep failing cannot hide the
// rows behind them; the run ends on the first empty page.
export async function purgeExpiredFileRefsWithBytes(args: {
  readonly db: TenantDb;
  readonly table: PurgeTable;
  readonly where: WhereObject;
  readonly expiredBefore: Temporal.Instant;
  readonly files: FileContext | undefined;
  readonly log: PurgeLog;
  readonly pageSize?: number;
}): Promise<void> {
  const { db, table, where, expiredBefore, files, log } = args;
  const pageSize = args.pageSize ?? EXPIRED_FILE_REF_PURGE_BATCH;
  if (!files) {
    log?.warn("[soft-delete-cleanup] no file storage available, expired fileRef rows kept");
    return;
  }
  const store = { list: files.list, delete: (key: string) => files.ref(key).delete() };
  let cursor: ExpiredRow | undefined;
  for (;;) {
    const rows = await selectNextPage({ db, table, where, expiredBefore, cursor, pageSize });
    const lastRow = rows[rows.length - 1];
    // skip: an empty page means every expired row has been visited
    if (lastRow === undefined) return;
    cursor = lastRow;
    const purgedIds: string[] = [];
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
}

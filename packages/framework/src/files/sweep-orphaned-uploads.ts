import type { FileContext } from "@cosmicdrift/kumiko-types/file-handle-types";
import type { Logger } from "@cosmicdrift/kumiko-types/logger";
import { selectMany } from "../db/query.ts";
import { runInOwnTransaction, type TenantDb } from "../db/tenant-db.ts";
import { deleteFileRefBytes } from "../derivatives/delete-stored-file.ts";
import { fileRefsTable } from "./file-ref-table.ts";
import { fileUploadLedgerTable, takeUploadLedgerEntry } from "./upload-ledger.ts";

export const ORPHANED_UPLOAD_SWEEP_BATCH = 500;
export const DEFAULT_UPLOAD_SWEEP_GRACE_HOURS = 24;
export const MIN_UPLOAD_SWEEP_GRACE_HOURS = 1;

type SweepLog = Pick<Logger, "warn"> | undefined;

// Each candidate gets its own short transaction that takes the ledger row first. A commit that
// holds the row makes the sweep wait and then find it gone; a sweep that took the row first makes
// the commit find it gone and fail, so bytes and fileRef row can never end up apart.
async function sweepOrphanedUpload(
  txDb: TenantDb,
  files: FileContext,
  storageKey: string,
): Promise<void> {
  const taken = await takeUploadLedgerEntry(txDb, storageKey);
  // skip: a commit took the row in the meantime and owns the bytes now
  if (!taken) return;
  const committedRows = await selectMany(
    txDb,
    fileRefsTable,
    { storageKey },
    { limit: 1, fields: ["id"] },
  );
  // skip: a fileRef row claims the bytes, only the stale ledger row goes
  if (committedRows.length > 0) return;
  const failedKeys = await deleteFileRefBytes(files, { storageKey }, "upload-ledger-sweep");
  if (failedKeys.length > 0) throw new Error("bytes not fully deleted");
}

// Deletes the bytes (original and derivatives) of uploads that never got a fileRef row within the
// grace period. Walks the ledger page by page along storage_key, so rows that keep failing or are
// locked cannot hide the rows behind them; a failed row rolls back and the next run retries it.
export async function sweepOrphanedUploads(args: {
  readonly db: TenantDb;
  readonly files: FileContext | undefined;
  readonly now: Temporal.Instant;
  readonly graceHours: number;
  readonly log: SweepLog;
  readonly pageSize?: number;
}): Promise<void> {
  const { db, files, now, graceHours, log } = args;
  const pageSize = args.pageSize ?? ORPHANED_UPLOAD_SWEEP_BATCH;
  if (!files) {
    log?.warn("[upload-ledger-sweep] no file storage available, orphaned uploads kept");
    return;
  }
  const cutoff = now.subtract({ hours: graceHours });
  let cursor: string | undefined;
  for (;;) {
    const rows = await selectMany<{ storageKey: string }>(
      db,
      fileUploadLedgerTable,
      { createdAt: { lt: cutoff }, ...(cursor !== undefined && { storageKey: { gt: cursor } }) },
      { orderBy: { col: "storageKey", direction: "asc" }, fields: ["storageKey"], limit: pageSize },
    );
    const lastRow = rows[rows.length - 1];
    // skip: an empty page means every due row has been visited
    if (lastRow === undefined) return;
    cursor = lastRow.storageKey;
    for (const { storageKey } of rows) {
      try {
        await runInOwnTransaction(db, (txDb) => sweepOrphanedUpload(txDb, files, storageKey));
      } catch (err) {
        log?.warn(
          `[upload-ledger-sweep] orphaned upload not deleted, retried next run: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}

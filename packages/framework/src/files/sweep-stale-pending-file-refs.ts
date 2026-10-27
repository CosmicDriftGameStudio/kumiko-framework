import type { Logger } from "@cosmicdrift/kumiko-types/logger";
import { selectMany } from "../db/query.ts";
import type { TenantDb } from "../db/tenant-db.ts";
import { createSystemUser, SYSTEM_USER_ID } from "../engine/system-user.ts";
import { getFileRefExecutor } from "./create-file-ref.ts";
import { fileRefsTable } from "./file-ref-table.ts";

export const STALE_PENDING_FILE_REF_SWEEP_BATCH = 500;

type PendingRow = {
  readonly id: string;
  readonly entityType: string | null;
  readonly insertedById: string | null;
};

// A pending upload names its target field (entityType set) but no record yet. Uploads without a
// target field (inbox, dropzone) and files the system generated are kept on purpose.
function isStalePendingUpload(row: PendingRow): boolean {
  return row.entityType !== null && row.insertedById !== SYSTEM_USER_ID;
}

// Soft-deletes pending uploads whose record never came, through the fileRef executor, so the
// soft-delete cleanup later removes their bytes like those of any deleted file.
export async function sweepStalePendingFileRefs(args: {
  readonly db: TenantDb;
  readonly now: Temporal.Instant;
  readonly graceHours: number;
  readonly log: Pick<Logger, "warn"> | undefined;
  readonly pageSize?: number;
}): Promise<number> {
  const { db, now, graceHours, log } = args;
  const pageSize = args.pageSize ?? STALE_PENDING_FILE_REF_SWEEP_BATCH;
  const cutoff = now.subtract({ hours: graceHours });
  const executor = getFileRefExecutor();
  const user = createSystemUser(db.tenantId);
  let swept = 0;
  let cursor: string | undefined;
  for (;;) {
    const rows = await selectMany<PendingRow>(
      db,
      fileRefsTable,
      {
        entityId: null,
        isDeleted: false,
        insertedAt: { lt: cutoff },
        ...(cursor !== undefined && { id: { gt: cursor } }),
      },
      {
        orderBy: { col: "id", direction: "asc" },
        fields: ["id", "entityType", "insertedById"],
        limit: pageSize,
      },
    );
    const lastRow = rows[rows.length - 1];
    // skip: an empty page means every due row has been visited
    if (lastRow === undefined) return swept;
    cursor = lastRow.id;
    for (const row of rows.filter(isStalePendingUpload)) {
      const removed = await executor.delete({ id: row.id }, user, db);
      if (removed.isSuccess) {
        swept++;
        continue;
      }
      log?.warn(
        `[pending-upload-sweep] pending fileRef ${row.id} not deleted, retried next run: ${removed.error.code}`,
      );
    }
  }
}

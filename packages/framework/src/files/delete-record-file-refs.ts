import type { TenantDb } from "../db/tenant-db.ts";
import type { SessionUser } from "../engine/types/index.ts";
import { reraiseAsKumikoError } from "../errors/index.ts";
import { getFileRefExecutor } from "./create-file-ref.ts";
import { fileRefsTable } from "./file-ref-table.ts";

// Same soft delete as DELETE /files/:id for every fileRef bound to one record, for owners that
// remove the record without an r.entity delete (a retention sweep over a projection read model).
export async function deleteFileRefsBoundToRecord(args: {
  readonly db: TenantDb;
  readonly user: SessionUser;
  readonly entityType: string;
  readonly entityId: string;
}): Promise<number> {
  const { db, user, entityType, entityId } = args;
  const rows = await db.selectMany<{ id: string }>(fileRefsTable, {
    entityType,
    entityId,
    isDeleted: false,
  });
  const executor = getFileRefExecutor();
  for (const row of rows) {
    const removed = await executor.delete({ id: row.id }, user, db);
    if (!removed.isSuccess) throw reraiseAsKumikoError(removed.error);
  }
  return rows.length;
}

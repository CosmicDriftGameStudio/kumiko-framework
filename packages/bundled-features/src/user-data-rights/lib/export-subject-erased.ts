import { type DbRunner, fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { USER_STATUS, type UserStatus, userTable } from "../../user/index.ts";

// Only erasure ends the export: Restricted (Art. 18) and DeletionRequested (reversible grace period)
// keep Art. 15 and 20. A missing row is not erasure, since the forget run keeps the anonymized row.
export async function isExportSubjectErased(db: DbRunner, userId: string): Promise<boolean> {
  const row = await fetchOne<{ status: UserStatus; isDeleted: boolean }>(db, userTable, {
    id: userId,
  });
  if (!row) return false;
  return row.isDeleted || row.status === USER_STATUS.Deleted;
}

// One query for a whole batch of subjects; same erasure rule as isExportSubjectErased.
export async function selectErasedExportSubjects(
  db: DbRunner,
  userIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await selectMany<{ id: string; status: UserStatus; isDeleted: boolean }>(
    db,
    userTable,
    { id: { in: [...userIds] } },
  );
  return new Set(
    rows.filter((r) => r.isDeleted || r.status === USER_STATUS.Deleted).map((r) => r.id),
  );
}

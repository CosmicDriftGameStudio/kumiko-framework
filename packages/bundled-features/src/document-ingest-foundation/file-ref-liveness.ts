// db.fetchOne applies TenantDb's tenant predicate but no isDeleted filter
// (see event-store-executor-write.ts's restore()/forget() comments) — a
// soft-deleted fileRef still round-trips as a row here.
import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";

export async function isFileRefLive(tenantDb: TenantDb, fileRefId: string): Promise<boolean> {
  const row = await tenantDb.fetchOne<{ isDeleted: boolean }>(fileRefsTable, { id: fileRefId });
  return row !== undefined && row.isDeleted !== true;
}

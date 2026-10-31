import type { EntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import { declareEscapeHatch, type TenantDataHookCtx } from "@cosmicdrift/kumiko-framework/engine";
import { archiveStream } from "@cosmicdrift/kumiko-framework/event-store";

export const TENANT_DESTROY_ARCHIVED_BY = "tenant-lifecycle:destroy";
export const TENANT_DESTROY_ARCHIVE_REASON = "tenant_destroy";

// Archiving first means a later projection rebuild cannot resurrect the deleted rows.
export async function archiveAndDeleteTenantRows(
  ctx: TenantDataHookCtx,
  table: EntityTableMeta,
  aggregateType: string,
  escapeHatchReason: string,
): Promise<readonly string[]> {
  declareEscapeHatch({ reason: escapeHatchReason });
  const rows = await ctx.db.selectMany<{ id: string }>(table, { tenantId: ctx.tenantId });
  for (const row of rows) {
    await archiveStream(ctx.db.unsafeRaw(), {
      tenantId: ctx.tenantId,
      aggregateId: row.id,
      aggregateType,
      archivedBy: TENANT_DESTROY_ARCHIVED_BY,
      reason: TENANT_DESTROY_ARCHIVE_REASON,
    });
  }
  await ctx.db.deleteMany(table, { tenantId: ctx.tenantId });
  return rows.map((row) => row.id);
}

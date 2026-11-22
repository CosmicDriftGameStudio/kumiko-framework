import type { TenantDataHookCtx } from "@cosmicdrift/kumiko-framework/engine";
import { archiveAndDeleteTenantRows } from "../tenant-lifecycle/index.ts";
import { LETTER_ENTITY } from "./constants.ts";
import { letterSubmissionTable, letterTable } from "./entity.ts";

export const LETTER_TENANT_DESTROY_ARCHIVE_REASON =
  "tenant-destroy archives the letter event-streams before the projection rows are deleted";

export async function letterTenantDestroyHook(ctx: TenantDataHookCtx): Promise<void> {
  await archiveAndDeleteTenantRows(
    ctx,
    letterTable,
    LETTER_ENTITY,
    LETTER_TENANT_DESTROY_ARCHIVE_REASON,
  );
}

export async function letterSubmissionTenantDestroyHook(ctx: TenantDataHookCtx): Promise<void> {
  await ctx.db.deleteMany(letterSubmissionTable, { tenantId: ctx.tenantId });
}

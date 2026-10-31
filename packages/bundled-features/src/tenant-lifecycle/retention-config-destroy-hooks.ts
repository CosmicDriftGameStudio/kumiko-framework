// The tenant's retention configuration (compliance profile, retention overrides) decides which
// entities are blockDelete-held. It is erased in the "tenant-row" phase, after the hold check, because
// deleting it earlier would change the hold predicate while the tenant still waits on held rows.

import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type EntityDefinition,
  type TenantDataHookCtx,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../compliance-profiles/index.ts";
import {
  tenantRetentionOverrideEntity,
  tenantRetentionOverrideTable,
} from "../data-retention/index.ts";

export const COMPLIANCE_PROFILE_ENTITY_NAME = "tenant-compliance-profile";
export const RETENTION_OVERRIDE_ENTITY_NAME = "tenant-retention-override";

type ExecutorTable = Parameters<typeof createEventStoreExecutor>[0];

async function forgetAllTenantRows(
  ctx: TenantDataHookCtx,
  table: ExecutorTable,
  entity: EntityDefinition,
  entityName: string,
): Promise<void> {
  const executor = createEventStoreExecutor(table, entity, { entityName });
  const user = createSystemUser(ctx.tenantId);
  const rows = await ctx.db.selectMany<{ id: string }>(table, { tenantId: ctx.tenantId });
  for (const row of rows) {
    const forgotten = await executor.forget({ id: row.id }, user, ctx.db);
    if (!forgotten.isSuccess) {
      throw new Error(
        `tenant-lifecycle: failed to forget ${entityName} ${row.id} for tenant ${ctx.tenantId}: ${forgotten.error.message}`,
      );
    }
  }
}

export async function complianceProfileTenantDestroyHook(ctx: TenantDataHookCtx): Promise<void> {
  await forgetAllTenantRows(
    ctx,
    tenantComplianceProfileTable,
    tenantComplianceProfileEntity,
    COMPLIANCE_PROFILE_ENTITY_NAME,
  );
}

export async function retentionOverrideTenantDestroyHook(ctx: TenantDataHookCtx): Promise<void> {
  // skip: data-retention is optional, without it the override table does not exist
  if (!ctx.registry.getEntity(RETENTION_OVERRIDE_ENTITY_NAME)) return;
  await forgetAllTenantRows(
    ctx,
    tenantRetentionOverrideTable,
    tenantRetentionOverrideEntity,
    RETENTION_OVERRIDE_ENTITY_NAME,
  );
}

import { deleteMany } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID, type TenantDataHookCtx } from "@cosmicdrift/kumiko-framework/engine";
import { archiveAndDeleteTenantRows } from "../tenant-lifecycle/index.ts";
import { CONNECTOR_ENTITY, INBOUND_ITEM_ENTITY } from "./constants.ts";
import { connectorTable } from "./schema/connector.ts";
import { deviceTable } from "./schema/device.ts";
import { deviceAuthorizationTable } from "./schema/device-authorization.ts";
import { inboundItemTable } from "./schema/inbound-item.ts";

export const CONNECTORS_TENANT_DESTROY_ARCHIVE_REASON =
  "tenant-destroy archives each connectors entity's event-streams before the projection rows are deleted";

export async function connectorTenantDestroyHook(ctx: TenantDataHookCtx): Promise<void> {
  await archiveAndDeleteTenantRows(
    ctx,
    connectorTable,
    CONNECTOR_ENTITY,
    CONNECTORS_TENANT_DESTROY_ARCHIVE_REASON,
  );
  // Device and pairing rows live in the system tenant (the device has no tenant before it is
  // paired), so the tenant-scoped ctx.db never sees them; the unsafeRaw grant was declared above.
  const allTenants = ctx.db.unsafeRawAllTenants();
  for (const table of [deviceTable, deviceAuthorizationTable]) {
    await deleteMany(allTenants, table, {
      tenantId: SYSTEM_TENANT_ID,
      ownerTenantId: ctx.tenantId,
    });
  }
}

export async function inboundItemTenantDestroyHook(ctx: TenantDataHookCtx): Promise<void> {
  await archiveAndDeleteTenantRows(
    ctx,
    inboundItemTable,
    INBOUND_ITEM_ENTITY,
    CONNECTORS_TENANT_DESTROY_ARCHIVE_REASON,
  );
}

import {
  access,
  createSystemUser,
  defineWriteHandler,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { CONNECTOR_STATUS, ConnectorHandlers } from "../constants.ts";
import { connectorExecutor } from "../schema/connector.ts";

const REVOKE_TOKENS_REASON =
  "device tokens live in the system tenant (the request carries only the secret, the tenant is found through the device row); revoking a connector must stamp them in the same transaction";

export const revokeConnectorWrite = defineWriteHandler({
  name: "revoke",
  schema: z.object({ id: z.uuid() }),
  access: { roles: access.admin },
  escapeHatch: { grants: ["systemIdentity"], reason: REVOKE_TOKENS_REASON },
  agent: { expose: false },
  description:
    "Revokes a connector: its device token stops working at once and it can no longer upload or send heartbeats. Use it when a satellite is retired or its machine is lost.",
  handler: async (event, ctx) => {
    const connector = await connectorExecutor.detail({ id: event.payload.id }, event.user, ctx.db);
    if (!connector) return failNotFound("connector", event.payload.id);
    if (connector.status !== CONNECTOR_STATUS.revoked) {
      const updated = await connectorExecutor.update(
        {
          id: event.payload.id,
          version: connector.version,
          changes: { status: CONNECTOR_STATUS.revoked },
        },
        event.user,
        ctx.db,
      );
      if (!updated.isSuccess) return updated;
    }
    const tokens = await ctx.dispatch.writeAs(
      createSystemUser(SYSTEM_TENANT_ID),
      ConnectorHandlers.revokeDeviceTokens,
      { ownerTenantId: event.user.tenantId, connectorId: event.payload.id },
    );
    if (!tokens.isSuccess) return tokens;
    return { isSuccess: true as const, data: { id: event.payload.id } };
  },
});

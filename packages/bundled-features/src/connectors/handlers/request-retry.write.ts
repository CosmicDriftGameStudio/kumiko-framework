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

const MARK_RETRY_REASON =
  "device rows live in the system tenant (the request carries only the secret, the tenant is found through the device row); the flag is set for the caller's own tenant's connector only";

export const requestRetryWrite = defineWriteHandler({
  name: "request-retry",
  schema: z.object({ id: z.uuid() }),
  access: { roles: access.admin },
  escapeHatch: { grants: ["systemIdentity"], reason: MARK_RETRY_REASON },
  agent: { expose: false },
  description:
    "Asks a satellite to retry its failed files: the next heartbeat answer carries the retry signal once.",
  handler: async (event, ctx) => {
    const connector = await connectorExecutor.detail({ id: event.payload.id }, event.user, ctx.db);
    if (!connector || connector.status === CONNECTOR_STATUS.revoked) {
      return failNotFound("connector", event.payload.id);
    }
    const marked = await ctx.dispatch.writeAs(
      createSystemUser(SYSTEM_TENANT_ID),
      ConnectorHandlers.markDeviceRetry,
      { ownerTenantId: event.user.tenantId, connectorId: event.payload.id },
    );
    if (!marked.isSuccess) return marked;
    return { isSuccess: true as const, data: { id: event.payload.id } };
  },
});

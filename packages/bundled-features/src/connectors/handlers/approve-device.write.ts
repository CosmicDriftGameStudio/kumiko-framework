import {
  access,
  createSystemUser,
  defineWriteHandler,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { unprocessable } from "../../shared/index.ts";
import {
  CODE_ATTEMPT_RATE_LIMIT,
  CONNECTOR_KIND,
  CONNECTOR_STATUS,
  ConnectorErrors,
  ConnectorHandlers,
} from "../constants.ts";
import { hashUserCode, normalizeUserCode } from "../hash.ts";
import { connectorExecutor } from "../schema/connector.ts";

const CLAIM_REASON =
  "the pairing request lives in the system tenant because the device has no tenant before this confirmation; the claim is a conditional update there, run in the confirming admin's transaction so the new connector rolls back when the code is invalid";

export const approveDeviceWrite = defineWriteHandler({
  name: "approve-device",
  schema: z.object({ userCode: z.string().min(1).max(32), name: z.string().min(1).max(120) }),
  access: { roles: access.admin },
  rateLimit: CODE_ATTEMPT_RATE_LIMIT,
  escapeHatch: { grants: ["systemIdentity"], reason: CLAIM_REASON },
  agent: { expose: false },
  description:
    "Confirms the pairing code a satellite shows: creates a connector with the given name in the caller's tenant and lets the waiting device collect its token. Use it when a tenant admin pairs a new satellite.",
  handler: async (event, ctx) => {
    const normalized = normalizeUserCode(event.payload.userCode);
    if (normalized === null) {
      return unprocessable(ConnectorErrors.invalidUserCode, "errors.connectors.invalidUserCode");
    }
    const created = await connectorExecutor.create(
      { name: event.payload.name, kind: CONNECTOR_KIND.satellite, status: CONNECTOR_STATUS.active },
      event.user,
      ctx.db,
    );
    if (!created.isSuccess) return created;
    const claimed = await ctx.dispatch.writeAs(
      createSystemUser(SYSTEM_TENANT_ID),
      ConnectorHandlers.claimAuthorization,
      {
        userCodeHash: hashUserCode(normalized),
        ownerTenantId: event.user.tenantId,
        connectorId: created.data.id,
        approvedByUserId: event.user.id,
      },
    );
    if (!claimed.isSuccess) return claimed;
    return { isSuccess: true as const, data: { connectorId: created.data.id } };
  },
});

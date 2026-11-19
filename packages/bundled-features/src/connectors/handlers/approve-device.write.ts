import {
  access,
  createSystemUser,
  defineWriteHandler,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { unprocessable } from "../../shared/index.ts";
import {
  CONNECTOR_KIND,
  CONNECTOR_STATUS,
  ConnectorErrors,
  ConnectorHandlers,
} from "../constants.ts";
import { formatUserCode, hashUserCode, normalizeUserCode } from "../hash.ts";
import { connectorExecutor } from "../schema/connector.ts";

const CLAIM_REASON =
  "the pairing request lives in the system tenant because the device has no tenant before this confirmation; the claim is a conditional update there, run in the confirming admin's transaction so the new connector rolls back when the code is invalid";

const CODE_ATTEMPT_RATE_LIMIT = { per: "user+handler", limit: 20, windowSeconds: 300 } as const;

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

const CHECK_REASON =
  "pairing requests live in the system tenant (the device has no tenant before an admin confirms its code); the check records on that request which admin looked at it, and when";

// Step one of the two-step pairing screen. A write handler because an actionForm can only submit
// to one; it records who checked the code (confirming needs that) and hands the code to the confirm step.
export const checkDeviceWrite = defineWriteHandler({
  name: "check-device",
  schema: z.object({ userCode: z.string().min(1).max(32) }),
  access: { roles: access.admin },
  rateLimit: CODE_ATTEMPT_RATE_LIMIT,
  escapeHatch: { grants: ["systemIdentity"], reason: CHECK_REASON },
  agent: { expose: false },
  description:
    "Checks that a pairing code shown by a satellite belongs to an open request, without confirming it. Use it as the first step before naming and confirming a device.",
  handler: async (event, ctx) => {
    const normalized = normalizeUserCode(event.payload.userCode);
    if (normalized === null) {
      return unprocessable(ConnectorErrors.invalidUserCode, "errors.connectors.invalidUserCode");
    }
    const marked = await ctx.dispatch.writeAs(
      createSystemUser(SYSTEM_TENANT_ID),
      ConnectorHandlers.markChecked,
      { userCodeHash: hashUserCode(normalized), userId: event.user.id },
    );
    if (!marked.isSuccess) return marked;
    return { isSuccess: true as const, data: { userCode: formatUserCode(normalized) } };
  },
});

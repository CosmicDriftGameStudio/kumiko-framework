import { updateMany } from "@cosmicdrift/kumiko-framework/db";
import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { unprocessable } from "../../shared/index.ts";
import { ConnectorErrors, DEVICE_AUTHORIZATION_STATUS } from "../constants.ts";
import { deviceAuthorizationTable } from "../schema/device-authorization.ts";

// pending -> approved in one conditional update, so a code confirmed twice (or confirmed while
// expired, denied or already used) claims nothing and the caller's connector rolls back.
export const claimAuthorizationWrite = defineWriteHandler({
  name: "claim-authorization",
  schema: z.object({
    userCodeHash: z.string().length(64),
    ownerTenantId: z.uuid(),
    connectorId: z.uuid(),
    approvedByUserId: z.string().min(1).max(36),
  }),
  access: { roles: access.system },
  agent: { expose: false },
  description:
    "Internal: binds a pending device pairing to the tenant, connector and admin that confirmed its user code; fails when the code is unknown, expired or no longer pending.",
  handler: async (event, ctx) => {
    const { userCodeHash, ...claim } = event.payload;
    const claimed = await updateMany(
      ctx.db,
      deviceAuthorizationTable,
      { status: DEVICE_AUTHORIZATION_STATUS.approved, ...claim },
      {
        userCodeHash,
        status: DEVICE_AUTHORIZATION_STATUS.pending,
        expiresAt: { gt: ctx.tz.now() },
      },
    );
    if (claimed.length === 0) {
      return unprocessable(ConnectorErrors.invalidUserCode, "errors.connectors.invalidUserCode");
    }
    return { isSuccess: true as const, data: { claimed: true } };
  },
});

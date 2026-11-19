import { deleteMany, updateMany } from "@cosmicdrift/kumiko-framework/db";
import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { deviceTable } from "../schema/device.ts";
import { deviceAuthorizationTable } from "../schema/device-authorization.ts";

export const revokeDeviceTokensWrite = defineWriteHandler({
  name: "revoke-device-tokens",
  schema: z.object({ ownerTenantId: z.uuid(), connectorId: z.uuid() }),
  access: { roles: access.system },
  agent: { expose: false },
  description:
    "Internal: stamps every still-valid device token of one connector as revoked (already revoked tokens keep their first revocation time) and drops its pairing requests, so a confirmed code that was not collected yet hands out no token.",
  handler: async (event, ctx) => {
    // Before the tokens: a poll that wins the redeem race still meets the connector's revoked status on its first upload.
    await deleteMany(ctx.db, deviceAuthorizationTable, event.payload);
    const revoked = await updateMany(
      ctx.db,
      deviceTable,
      { revokedAt: ctx.tz.now() },
      { ...event.payload, revokedAt: null },
    );
    return { isSuccess: true as const, data: { revoked: revoked.length } };
  },
});

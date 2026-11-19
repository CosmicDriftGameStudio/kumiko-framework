import { updateMany } from "@cosmicdrift/kumiko-framework/db";
import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { deviceTable } from "../schema/device.ts";

export const revokeDeviceTokensWrite = defineWriteHandler({
  name: "revoke-device-tokens",
  schema: z.object({ ownerTenantId: z.uuid(), connectorId: z.uuid() }),
  access: { roles: access.system },
  agent: { expose: false },
  description:
    "Internal: stamps every still-valid device token of one connector as revoked; already revoked tokens keep their first revocation time.",
  handler: async (event, ctx) => {
    const revoked = await updateMany(
      ctx.db,
      deviceTable,
      { revokedAt: ctx.tz.now() },
      { ...event.payload, revokedAt: null },
    );
    return { isSuccess: true as const, data: { revoked: revoked.length } };
  },
});

import { updateMany } from "@cosmicdrift/kumiko-framework/db";
import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { deviceTable } from "../schema/device.ts";

export const markDeviceRetryWrite = defineWriteHandler({
  name: "mark-device-retry",
  schema: z.object({ ownerTenantId: z.uuid(), connectorId: z.uuid() }),
  access: { roles: access.system },
  agent: { expose: false },
  description:
    "Internal: flags the live device of one connector so its next heartbeat answer asks the satellite to retry its failed files.",
  handler: async (event, ctx) => {
    const marked = await updateMany(
      ctx.db,
      deviceTable,
      { retryRequestedAt: ctx.tz.now() },
      { ...event.payload, revokedAt: null },
    );
    return { isSuccess: true as const, data: { marked: marked.length } };
  },
});

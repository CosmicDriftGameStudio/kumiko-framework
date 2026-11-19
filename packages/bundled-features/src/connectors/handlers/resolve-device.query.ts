import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { access, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { deviceTable } from "../schema/device.ts";
import { type DeviceRow, isoOrNull } from "./device-row.ts";

// Hot path of every satellite request: one point read by token hash, no tenant context yet.
export const resolveDeviceQuery = defineQueryHandler({
  name: "resolve-device",
  schema: z.object({ tokenHash: z.string().length(64) }),
  access: { roles: access.system },
  agent: { expose: false },
  description:
    "Internal: finds the device a token hash belongs to, with its tenant, connector and revocation state.",
  handler: async (query, ctx) => {
    const row = await fetchOne<DeviceRow>(ctx.db, deviceTable, {
      tokenHash: query.payload.tokenHash,
    });
    if (row === undefined) return null;
    return {
      deviceId: row.id,
      ownerTenantId: row.ownerTenantId,
      connectorId: row.connectorId,
      lastSeenAt: isoOrNull(row.lastSeenAt),
      revokedAt: isoOrNull(row.revokedAt),
    };
  },
});

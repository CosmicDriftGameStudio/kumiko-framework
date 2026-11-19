import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { access, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { deviceTable } from "../schema/device.ts";
import { type DeviceRow, isoOrNull } from "./device-row.ts";

export const listDevicesQuery = defineQueryHandler({
  name: "list-devices",
  schema: z.object({ ownerTenantId: z.uuid() }),
  access: { roles: access.system },
  agent: { expose: false },
  description: "Internal: the paired devices of one tenant's connectors, without token material.",
  handler: async (query, ctx) =>
    (
      await selectMany<DeviceRow>(ctx.db, deviceTable, {
        ownerTenantId: query.payload.ownerTenantId,
      })
    ).map((row) => ({
      connectorId: row.connectorId,
      tokenPrefix: row.tokenPrefix,
      reportedVersion: row.reportedVersion,
      lastSeenAt: isoOrNull(row.lastSeenAt),
      revokedAt: isoOrNull(row.revokedAt),
    })),
});

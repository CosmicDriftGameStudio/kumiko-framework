import { updateMany } from "@cosmicdrift/kumiko-framework/db";
import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { HEARTBEAT_MIN_INTERVAL_MINUTES } from "../constants.ts";
import { deviceTable } from "../schema/device.ts";

// Throttled: a device that uploads in bursts must not rewrite its row per file. `where` has no OR,
// so each way to qualify is its own conditional update: never seen, seen long ago, or a reported
// version that differs from the stored one (an upgrade must show up at once, not after the throttle).
export const touchDeviceWrite = defineWriteHandler({
  name: "touch-device",
  schema: z.object({
    deviceId: z.uuid(),
    reportedVersion: z.string().min(1).max(64).optional(),
  }),
  access: { roles: access.system },
  agent: { expose: false },
  description:
    "Internal: records that a device was seen (and the software version it reported), at most once per few minutes.",
  handler: async (event, ctx) => {
    const now = ctx.tz.now();
    const set = {
      lastSeenAt: now,
      ...(event.payload.reportedVersion !== undefined && {
        reportedVersion: event.payload.reportedVersion,
      }),
    };
    const { deviceId } = event.payload;
    const { reportedVersion } = event.payload;
    const qualifying = [
      { lastSeenAt: null },
      { lastSeenAt: { lt: now.subtract({ minutes: HEARTBEAT_MIN_INTERVAL_MINUTES }) } },
      ...(reportedVersion === undefined
        ? []
        : [{ reportedVersion: null }, { reportedVersion: { ne: reportedVersion } }]),
    ];
    for (const condition of qualifying) {
      const updated = await updateMany(ctx.db, deviceTable, set, { id: deviceId, ...condition });
      if (updated.length > 0) break;
    }
    return { isSuccess: true as const, data: { ok: true } };
  },
});

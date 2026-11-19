import { updateMany } from "@cosmicdrift/kumiko-framework/db";
import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { HEARTBEAT_MIN_INTERVAL_MINUTES, SYNC_STATE } from "../constants.ts";
import { deviceTable } from "../schema/device.ts";

export const syncReportSchema = z.object({
  state: z.enum([SYNC_STATE.idle, SYNC_STATE.syncing, SYNC_STATE.error]),
  queued: z.number().int().min(0),
  failed: z.number().int().min(0),
  lastSyncAt: z.iso.datetime().optional(),
});

// Throttled: a device that uploads in bursts must not rewrite its row per file. `where` has no OR,
// so each way to qualify is its own conditional update: never seen, seen long ago, or a reported
// version that differs from the stored one (an upgrade must show up at once, not after the throttle).
export const touchDeviceWrite = defineWriteHandler({
  name: "touch-device",
  schema: z.object({
    deviceId: z.uuid(),
    reportedVersion: z.string().min(1).max(64).optional(),
    sync: syncReportSchema.optional(),
    // Only the heartbeat hands the retry signal to the satellite; an upload must not swallow it.
    consumeRetry: z.boolean().optional(),
    upload: z.enum(["accepted", "quotaRejected"]).optional(),
  }),
  access: { roles: access.system },
  agent: { expose: false },
  description:
    "Internal: records that a device was seen (and the software version it reported), at most once per few minutes.",
  handler: async (event, ctx) => {
    const now = ctx.tz.now();
    const { sync } = event.payload;
    const set = {
      lastSeenAt: now,
      ...(event.payload.reportedVersion !== undefined && {
        reportedVersion: event.payload.reportedVersion,
      }),
      ...(sync !== undefined && {
        syncState: sync.state,
        syncQueued: sync.queued,
        syncFailed: sync.failed,
        ...(sync.lastSyncAt !== undefined && {
          syncLastAt: Temporal.Instant.from(sync.lastSyncAt),
        }),
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
      // A change of state or failure count is shown at once, like a new version.
      ...(sync === undefined
        ? []
        : [
            { syncState: null },
            { syncState: { ne: sync.state } },
            { syncFailed: null },
            { syncFailed: { ne: sync.failed } },
          ]),
    ];
    for (const condition of qualifying) {
      const updated = await updateMany(ctx.db, deviceTable, set, { id: deviceId, ...condition });
      if (updated.length > 0) break;
    }
    // Conditional both ways: a paused satellite retrying or a normal upload adds no write.
    if (event.payload.upload === "quotaRejected") {
      await updateMany(
        ctx.db,
        deviceTable,
        { quotaRejectedAt: now },
        { id: deviceId, quotaRejectedAt: null },
      );
    } else if (event.payload.upload === "accepted") {
      await updateMany(
        ctx.db,
        deviceTable,
        { quotaRejectedAt: null },
        { id: deviceId, quotaRejectedAt: { ne: null } },
      );
    }
    // One conditional update: of two parallel heartbeats only one clears the flag and gets `retry`.
    const retry =
      event.payload.consumeRetry === true &&
      (
        await updateMany(
          ctx.db,
          deviceTable,
          { retryRequestedAt: null },
          { id: deviceId, retryRequestedAt: { ne: null } },
        )
      ).length > 0;
    return { isSuccess: true as const, data: { ok: true, retry } };
  },
});

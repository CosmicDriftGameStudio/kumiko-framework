import { deleteMany, fetchOne, insertOne } from "@cosmicdrift/kumiko-framework/db";
import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import * as z from "zod";
import {
  DEVICE_AUTHORIZATION_STATUS,
  POLL_INTERVAL_SECONDS,
  USER_CODE_TTL_SECONDS,
} from "../constants.ts";
import { hashUserCode, mintDeviceCode, mintUserCode } from "../hash.ts";
import { deviceAuthorizationTable } from "../schema/device-authorization.ts";

const MAX_USER_CODE_ATTEMPTS = 5;

// Starts a pairing: the device gets a long device code to poll with and a short user code a
// TenantAdmin confirms. Only hashes are stored.
export const deviceStartWrite = defineWriteHandler({
  name: "device-start",
  schema: z.object({ requestIp: z.string().max(64) }),
  access: { roles: access.system },
  agent: { expose: false },
  description:
    "Internal: starts a device pairing for the satellite route and returns a device code, a user code to confirm, its lifetime and the polling interval.",
  handler: async (event, ctx) => {
    const now = ctx.tz.now();
    await deleteMany(ctx.db, deviceAuthorizationTable, { expiresAt: { lt: now } });
    const deviceCode = mintDeviceCode();
    // Checked before the insert: a unique violation would abort the surrounding transaction.
    for (let attempt = 0; attempt < MAX_USER_CODE_ATTEMPTS; attempt++) {
      const userCode = mintUserCode();
      const userCodeHash = hashUserCode(userCode.normalized);
      if (await fetchOne(ctx.db, deviceAuthorizationTable, { userCodeHash })) continue;
      await insertOne(ctx.db, deviceAuthorizationTable, {
        id: generateId(),
        deviceCodeHash: deviceCode.hash,
        userCodeHash,
        status: DEVICE_AUTHORIZATION_STATUS.pending,
        requestIp: event.payload.requestIp,
        intervalSeconds: POLL_INTERVAL_SECONDS,
        expiresAt: now.add({ seconds: USER_CODE_TTL_SECONDS }),
        createdAt: now,
      });
      return {
        isSuccess: true as const,
        data: {
          deviceCode: deviceCode.raw,
          userCode: userCode.display,
          expiresIn: USER_CODE_TTL_SECONDS,
          interval: POLL_INTERVAL_SECONDS,
        },
      };
    }
    throw new Error("device-start: no free user code after repeated collisions");
  },
});

import { deleteMany, fetchOne, insertOne, updateMany } from "@cosmicdrift/kumiko-framework/db";
import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import {
  APPROVED_REDEEM_GRACE_SECONDS,
  DEVICE_AUTHORIZATION_STATUS,
  SLOW_DOWN_INCREMENT_SECONDS,
} from "../constants.ts";
import { hashDeviceSecret, mintDeviceToken } from "../hash.ts";
import { deviceTable } from "../schema/device.ts";
import { deviceAuthorizationTable } from "../schema/device-authorization.ts";

type AuthorizationRow = {
  readonly id: string;
  readonly status: string;
  readonly ownerTenantId: string | null;
  readonly connectorId: string | null;
  readonly intervalSeconds: number;
  readonly lastPolledAt: Temporal.Instant | null;
  readonly expiresAt: Temporal.Instant;
};

// RFC 8628 outcomes, returned as data (not as failures) so the route maps them to the
// `{error}` body the OAuth client library expects.
export type DevicePollOutcome =
  | { readonly kind: "token"; readonly accessToken: string }
  | {
      readonly kind: "authorization_pending" | "slow_down" | "expired_token" | "invalid_grant";
    };

function outcome(data: DevicePollOutcome) {
  return { isSuccess: true as const, data };
}

export const devicePollWrite = defineWriteHandler({
  name: "device-poll",
  schema: z.object({ deviceCode: z.string().min(1).max(200) }),
  access: { roles: access.system },
  agent: { expose: false },
  description:
    "Internal: the satellite route's token polling. Hands out the device token exactly once after a TenantAdmin confirmed the pairing, and otherwise answers with the RFC 8628 state.",
  handler: async (event, ctx) => {
    const now = ctx.tz.now();
    const row = await fetchOne<AuthorizationRow>(ctx.db, deviceAuthorizationTable, {
      deviceCodeHash: hashDeviceSecret(event.payload.deviceCode),
    });
    if (row === undefined) return outcome({ kind: "invalid_grant" });
    // A confirmed code stays redeemable past its expiry: the admin may confirm in its last seconds.
    const redeemableUntil =
      row.status === DEVICE_AUTHORIZATION_STATUS.approved
        ? row.expiresAt.add({ seconds: APPROVED_REDEEM_GRACE_SECONDS })
        : row.expiresAt;
    if (redeemableUntil.epochMilliseconds <= now.epochMilliseconds) {
      return outcome({ kind: "expired_token" });
    }

    if (row.status === DEVICE_AUTHORIZATION_STATUS.pending) {
      const tooFast =
        row.lastPolledAt !== null &&
        now.epochMilliseconds - row.lastPolledAt.epochMilliseconds < row.intervalSeconds * 1000;
      await updateMany(
        ctx.db,
        deviceAuthorizationTable,
        {
          lastPolledAt: now,
          ...(tooFast && { intervalSeconds: row.intervalSeconds + SLOW_DOWN_INCREMENT_SECONDS }),
        },
        { id: row.id },
      );
      return outcome({ kind: tooFast ? "slow_down" : "authorization_pending" });
    }

    // Approved: the conditional delete is the single redeem, so two parallel polls never both win;
    // deleting also drops the request address with the row.
    const redeemed = await deleteMany(ctx.db, deviceAuthorizationTable, {
      id: row.id,
      status: DEVICE_AUTHORIZATION_STATUS.approved,
    });
    if (redeemed === 0 || row.ownerTenantId === null || row.connectorId === null) {
      return outcome({ kind: "invalid_grant" });
    }
    const token = mintDeviceToken();
    await insertOne(ctx.db, deviceTable, {
      id: generateId(),
      ownerTenantId: row.ownerTenantId,
      connectorId: row.connectorId,
      tokenHash: token.hash,
      tokenPrefix: token.prefix,
      createdAt: now,
    });
    return outcome({ kind: "token", accessToken: token.raw });
  },
});

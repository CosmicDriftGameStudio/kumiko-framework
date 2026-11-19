import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { access, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { DEVICE_AUTHORIZATION_STATUS } from "../constants.ts";
import { deviceAuthorizationTable } from "../schema/device-authorization.ts";

type PendingAuthorizationRow = {
  readonly requestIp: string;
  readonly createdAt: Temporal.Instant;
  readonly expiresAt: Temporal.Instant;
};

export const resolvePendingAuthorizationQuery = defineQueryHandler({
  name: "resolve-pending-authorization",
  schema: z.object({ userCodeHash: z.string().length(64) }),
  access: { roles: access.system },
  agent: { expose: false },
  description:
    "Internal: reads when and from which IP a still pending, unexpired device pairing was requested.",
  handler: async (query, ctx) => {
    const [row] = await selectMany<PendingAuthorizationRow>(ctx.db, deviceAuthorizationTable, {
      userCodeHash: query.payload.userCodeHash,
      status: DEVICE_AUTHORIZATION_STATUS.pending,
      expiresAt: { gt: ctx.tz.now() },
    });
    if (row === undefined) return null;
    return {
      requestedAt: row.createdAt.toString(),
      requestIp: row.requestIp,
      expiresAt: row.expiresAt.toString(),
    };
  },
});

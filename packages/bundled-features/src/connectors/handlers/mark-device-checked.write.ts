import { updateMany } from "@cosmicdrift/kumiko-framework/db";
import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { unprocessable } from "../../shared/index.ts";
import { ConnectorErrors, DEVICE_AUTHORIZATION_STATUS } from "../constants.ts";
import { deviceAuthorizationTable } from "../schema/device-authorization.ts";

// Records which admin looked at a pending code and when; an unknown, expired or confirmed code
// matches nothing and answers like any invalid code.
export const markDeviceCheckedWrite = defineWriteHandler({
  name: "mark-device-checked",
  schema: z.object({ userCodeHash: z.string().length(64), userId: z.string().min(1).max(36) }),
  access: { roles: access.system },
  agent: { expose: false },
  description:
    "Internal: notes on a pending device pairing which admin checked its user code and when; fails when the code is unknown, expired or no longer pending.",
  handler: async (event, ctx) => {
    const now = ctx.tz.now();
    const marked = await updateMany(
      ctx.db,
      deviceAuthorizationTable,
      { checkedByUserId: event.payload.userId, checkedAt: now },
      {
        userCodeHash: event.payload.userCodeHash,
        status: DEVICE_AUTHORIZATION_STATUS.pending,
        expiresAt: { gt: now },
      },
    );
    if (marked.length === 0) {
      return unprocessable(ConnectorErrors.invalidUserCode, "errors.connectors.invalidUserCode");
    }
    return { isSuccess: true as const, data: { marked: true } };
  },
});

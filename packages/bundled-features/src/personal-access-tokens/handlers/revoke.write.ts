import { updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { apiTokenTable } from "../schema/api-token";

// Revoke one of the caller's own tokens. Ownership is enforced in the WHERE
// (userId = caller), so a caller can't revoke another user's token and a miss
// is a uniform ownership error with no existence oracle. isNull(revokedAt)
// keeps a double-revoke from overwriting the original timestamp.
export const revokePatWrite = defineWriteHandler({
  name: "revoke",
  schema: z.object({ id: z.uuid() }),
  access: { openToAll: true },
  handler: async (event, ctx) => {
    const updated = await updateMany(
      ctx.db,
      apiTokenTable,
      { revokedAt: Temporal.Now.instant() },
      { id: event.payload.id, userId: event.user.id, revokedAt: null },
    );
    if (updated.length > 0) return { isSuccess: true, data: { id: event.payload.id } };
    return writeFailure(
      new UnprocessableError("api-token:ownership_denied", {
        i18nKey: "errors.ownershipDenied",
        details: {
          scope: "entity",
          entityName: "api-token",
          action: "revoke",
          userId: event.user.id,
        },
      }),
    );
  },
});

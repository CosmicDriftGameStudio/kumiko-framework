import { updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { Temporal } from "temporal-polyfill";
import * as z from "zod";
import { PatErrors } from "../constants";
import { PAT_REVOKED_AGGREGATE_TYPE, PAT_REVOKED_EVENT_QN } from "../pat-revoked-event";
import { apiTokenTable } from "../schema/api-token";

// Revoke one of the caller's own tokens. Ownership is enforced in the WHERE
// (userId = caller), so a caller can't revoke another user's token and a miss
// is a uniform ownership error with no existence oracle. isNull(revokedAt)
// keeps a double-revoke from overwriting the original timestamp.
export const revokePatWrite = defineWriteHandler({
  name: "revoke",
  schema: z.object({ id: z.uuid() }),
  access: {
    openToAll: {
      reason:
        "each signed-in user revokes only their own personal access token; ownership " +
        "is enforced in the WHERE (userId = caller)",
    },
  },
  description:
    "Permanently revokes one of the caller's own personal access tokens so it stops authenticating; use it when a token leaked or is no longer needed.",
  agent: { risk: "high" },
  handler: async (event, ctx) => {
    const updated = await updateMany(
      ctx.db,
      apiTokenTable,
      { revokedAt: Temporal.Now.instant() },
      { id: event.payload.id, userId: event.user.id, revokedAt: null },
    );
    if (updated.length > 0) {
      // Lightweight append alongside the direct-write above, mirroring
      // sessions' revoke.write.ts. NOT a lifecycle event for
      // store_api_tokens (that table stays an unmanaged direct-write store,
      // see feature.ts). Without this, the access-invalidation consumer
      // never hears about the revoke and an already-open SSE stream
      // authenticated by this exact token survives it.
      await ctx.unsafeAppendEvent({
        aggregateId: generateId(),
        aggregateType: PAT_REVOKED_AGGREGATE_TYPE,
        type: PAT_REVOKED_EVENT_QN,
        payload: { userId: event.user.id, tokenIds: [event.payload.id] },
      });
      return { isSuccess: true, data: { id: event.payload.id } };
    }
    return writeFailure(
      new UnprocessableError(PatErrors.ownershipDenied, {
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

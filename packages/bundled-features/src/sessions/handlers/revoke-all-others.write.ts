import { updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { SessionErrors } from "../constants";
import { userSessionTable } from "../schema/user-session";
import { SESSION_REVOKED_AGGREGATE_TYPE, SESSION_REVOKED_EVENT_QN } from "../session-revoked-event";

// "Sign out everywhere else" — keep the caller's current session, kill all
// other live sessions for this user. Requires `user.sid` so "keep current"
// is well-defined; without it we refuse loudly rather than silently nuking
// the caller's own session along with the others.
export const revokeAllOthersWrite = defineWriteHandler({
  name: "user-session:revoke-all-others",
  schema: z.object({}),
  access: { openToAll: true },
  handler: async (event, ctx) => {
    const keepSid = event.user.sid;
    if (!keepSid) {
      return writeFailure(
        new UnprocessableError(SessionErrors.sessionRequired, {
          i18nKey: "sessions.errors.sessionRequired",
          details: { userId: event.user.id },
        }),
      );
    }

    const updated = await updateMany<{ id: string }>(
      ctx.db,
      userSessionTable,
      { revokedAt: Temporal.Now.instant() },
      { userId: event.user.id, revokedAt: null, id: { ne: keepSid } },
    );

    // Lightweight append alongside the direct-write above (#1559) — see
    // revoke.write.ts for why this isn't a lifecycle event on
    // store_user_sessions. Skipped when nothing was revoked (no other
    // live sessions) — a spurious invalidation would be the failure mode.
    if (updated.length > 0) {
      await ctx.unsafeAppendEvent({
        aggregateId: generateId(),
        aggregateType: SESSION_REVOKED_AGGREGATE_TYPE,
        type: SESSION_REVOKED_EVENT_QN,
        payload: {
          userId: event.user.id,
          sessionIds: updated.map((row) => row.id),
        },
      });
    }

    return { isSuccess: true, data: { count: updated.length } };
  },
});

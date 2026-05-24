import { updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { SessionErrors } from "../constants";
import { userSessionTable } from "../schema/user-session";

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

    const updated = await updateMany(
      ctx.db,
      userSessionTable,
      { revokedAt: Temporal.Now.instant() },
      { userId: event.user.id, revokedAt: null, id: { ne: keepSid } },
    );

    return { isSuccess: true, data: { count: updated.length } };
  },
});

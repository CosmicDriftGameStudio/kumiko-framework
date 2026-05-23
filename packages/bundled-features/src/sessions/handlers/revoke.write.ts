import { fetchOne, updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { SessionErrors } from "../constants";
import { userSessionTable } from "../schema/user-session";

// Revoke a single session by id (= JWT jti). Three distinguishable outcomes:
//
//   - Success: row existed, belonged to the caller, was live → revokedAt
//     stamped to now().
//   - already_revoked: row existed, belonged to the caller, was ALREADY
//     revoked → distinct error so UIs can show "logged out at <time>"
//     instead of a generic access-denied. Audit's original revokedAt is
//     preserved (isNull-guard on the UPDATE).
//   - ownership_denied: row didn't exist OR belonged to another user. Same
//     response for both branches = no existence oracle for other users' sids.
//
// Try the UPDATE first with the full constraint set (id + userId + live);
// if it touches zero rows, a second SELECT disambiguates the reason. The
// second roundtrip only happens on the error path — success stays single-
// roundtrip.
export const revokeWrite = defineWriteHandler({
  name: "user-session:revoke",
  schema: z.object({
    id: z.uuid(),
  }),
  access: { openToAll: true },
  handler: async (event, ctx) => {
    const updated = await updateMany(
      ctx.db,
      userSessionTable,
      { revokedAt: Temporal.Now.instant() },
      { id: event.payload.id, userId: event.user.id, revokedAt: null },
    );

    if (updated.length > 0) {
      return { isSuccess: true, data: { id: event.payload.id } };
    }

    // Zero rows touched — disambiguate between "not yours" and "already
    // revoked" via a point-read. Only hits on the error path.
    const row = await fetchOne<{ userId: string; revokedAt: unknown }>(
      ctx.db,
      userSessionTable,
      { id: event.payload.id },
    );

    if (row && row.userId === event.user.id && row.revokedAt !== null) {
      return writeFailure(
        new UnprocessableError(SessionErrors.alreadyRevoked, {
          i18nKey: "sessions.errors.alreadyRevoked",
          details: { id: event.payload.id },
        }),
      );
    }

    return writeFailure(
      new UnprocessableError(SessionErrors.ownershipDenied, {
        i18nKey: "errors.ownershipDenied",
        details: {
          scope: "entity",
          entityName: "user-session",
          action: "revoke",
          userId: event.user.id,
        },
      }),
    );
  },
});

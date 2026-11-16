import { defineWriteHandler, type HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { USER_STATUS, userTable } from "../../user/index.ts";
import { deletionCancelAnchor, redeemDeletionCancelToken } from "../deletion-token.ts";
import { cancelPendingDeletion } from "./cancel-deletion.write.ts";

export type CancelDeletionByTokenOptions = {
  readonly deletionTokenSecret?: string;
};

// Same generic 422 for every failure path so callers cannot tell a bad token
// from an unknown user or an account without a pending deletion.
function invalidToken(): UnprocessableError {
  return new UnprocessableError("invalid_or_expired_token");
}

// userId comes from the not-yet-verified token (attacker-controlled input); a
// failed lookup must not surface as a 500. HMAC verification stays the gate.
async function readPendingDeletionAnchor(
  ctx: HandlerContext,
  userId: string,
): Promise<string | null> {
  try {
    const row = await ctx.db
      .global(userTable)
      .fetchOne<{ status: string; gracePeriodEnd: Temporal.Instant | null }>({ id: userId });
    if (row?.status !== USER_STATUS.DeletionRequested || row.gracePeriodEnd == null) return null;
    return deletionCancelAnchor(row.gracePeriodEnd);
  } catch {
    return null;
  }
}

// Anonymous counterpart of cancel-deletion for a user who cannot sign in: a
// deletionRequested account fails the login gate, so the link in the
// deletion-requested mail is the only way back. The token is anchored to the
// current gracePeriodEnd, so it dies the moment the deletion is cancelled
// (gracePeriodEnd nulled) or re-requested (new gracePeriodEnd).
export function createCancelDeletionByTokenHandler(opts: CancelDeletionByTokenOptions = {}) {
  return defineWriteHandler({
    name: "cancel-deletion-by-token",
    schema: z.object({ token: z.string().min(1) }),
    access: {
      roles: ["anonymous"],
      anySignedIn: true,
    },
    escapeHatch: {
      grants: ["unsafeRaw", "globalWrites"],
      reason:
        "the anonymous token holder has no session; the user lifecycle event is appended on " +
        "the SYSTEM_TENANT_ID user stream and the user row is read tenant-agnostically, " +
        "gated by the HMAC-verified cancel token",
    },
    agent: { expose: false },
    rateLimit: { per: "ip+handler", limit: 10, windowSeconds: 60 },
    handler: async (event, ctx) => {
      const verified = await redeemDeletionCancelToken({
        token: event.payload.token,
        secret: opts.deletionTokenSecret,
        loadPendingGracePeriodAnchor: (userId) => readPendingDeletionAnchor(ctx, userId),
        commitCancel: async (userId) => (await cancelPendingDeletion(ctx, userId)).ok,
      });
      if (!verified.ok) return writeFailure(invalidToken());

      return { isSuccess: true as const, data: { status: USER_STATUS.Active } };
    },
  });
}

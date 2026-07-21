import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { USER_STATUS, userTable } from "../../user";
import { updateUserLifecycle } from "../lib/update-user-lifecycle";

// POST /api/user/lift-restriction (S2.U6) — DSGVO Art. 18 Reverse.
//
// Operator-only. A Restricted user's own session is unconditionally
// rejected by sessionChecker (BLOCKED_STATUSES) the moment their status
// flips — their JWT/login can't reach this or any other authenticated
// endpoint. There is no self-service path today, so lifting a restriction
// always targets someone else's account by id.
//
// State-Transitions:
//   Restricted → Active        ✓
//   Active → ...               ✗ 422 not_restricted (Idempotenz-Guard)
//   DeletionRequested → ...    ✗ 422 not_restricted
//   Deleted → ...              ✗ 422 not_restricted
export const liftRestrictionWrite = defineWriteHandler({
  name: "lift-restriction",
  schema: z.object({ userId: z.string() }),
  access: { roles: access.admin },
  handler: async (event, ctx) => {
    const targetUserId = event.payload.userId;
    const userRow = await fetchOne<{ status: string }>(ctx.db.raw, userTable, {
      id: targetUserId,
    });

    if (!userRow) {
      return writeFailure(
        new UnprocessableError("user_not_found", {
          details: { reason: "user_not_found", userId: targetUserId },
        }),
      );
    }

    const currentStatus = userRow["status"];
    if (currentStatus !== USER_STATUS.Restricted) {
      return writeFailure(
        new UnprocessableError("not_restricted", {
          details: { reason: "not_restricted", currentStatus },
        }),
      );
    }

    await updateUserLifecycle(ctx.db.raw, targetUserId, { status: USER_STATUS.Active });

    return {
      isSuccess: true as const,
      data: {
        userId: targetUserId,
        status: USER_STATUS.Active,
      },
    };
  },
});

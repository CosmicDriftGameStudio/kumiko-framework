import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { isWithinGracePeriod } from "../../shared";
import { USER_STATUS, userTable } from "../../user";
import { updateUserLifecycle } from "../lib/update-user-lifecycle";

const APPEND_LIFECYCLE_EVENT_REASON =
  "appends the user lifecycle event on the SYSTEM_TENANT_ID user stream";

// POST /api/user/cancel-deletion (S2.U5).
//
// Innerhalb der Grace-Period kann User seinen Forget-Antrag zurueck-
// nehmen. Setzt:
//   - status = "active"
//   - gracePeriodEnd = null
//
// Nach Grace-Period: 422 (run-forget-cleanup hat in der Zwischenzeit
// die Hooks schon getriggert — Reversal nicht moeglich).
//
// Sonderfall: Cancel als "active"-User → 422 (kein pending Forget).
export const cancelDeletionWrite = defineWriteHandler({
  name: "cancel-deletion",
  schema: z.object({}),
  access: {
    openToAll: {
      reason:
        "each signed-in user cancels only their own pending deletion request; the " +
        "lookup and update are scoped to the caller's own id",
    },
  },
  description:
    "Withdraws the calling user's own pending account-deletion request and puts the account back to active, accepted only while the grace period is still running.",
  escapeHatch: {
    reason: APPEND_LIFECYCLE_EVENT_REASON,
  },
  handler: async (event, ctx) => {
    const row = await ctx.db.global(userTable).fetchOne<{
      status: string;
      gracePeriodEnd: Temporal.Instant | null;
    }>({ id: event.user.id });

    if (!row) {
      return writeFailure(
        new UnprocessableError("user_not_found", {
          details: { userId: event.user.id },
        }),
      );
    }

    if (row.status !== USER_STATUS.DeletionRequested) {
      return writeFailure(
        new UnprocessableError("no_pending_deletion", {
          details: { currentStatus: row.status },
        }),
      );
    }

    if (!isWithinGracePeriod(row.gracePeriodEnd)) {
      return writeFailure(new UnprocessableError("grace_period_expired"));
    }

    await updateUserLifecycle(ctx.db.unsafeRaw(APPEND_LIFECYCLE_EVENT_REASON), event.user.id, {
      status: USER_STATUS.Active,
      gracePeriodEnd: null,
      // #354/1: closes the replay-after-cancel window — a still-TTL-valid email
      // token verified against the nulled requestId can no longer arm a second grace period.
      pendingDeletionRequestId: null,
    });

    // gracePeriodEnd=null im Response symmetrisch zu request-deletion's
    // ISO-Timestamp — Frontend kann beide Endpoints uniform behandeln.
    return {
      isSuccess: true as const,
      data: {
        userId: event.user.id,
        status: USER_STATUS.Active,
        gracePeriodEnd: null as string | null,
      },
    };
  },
});

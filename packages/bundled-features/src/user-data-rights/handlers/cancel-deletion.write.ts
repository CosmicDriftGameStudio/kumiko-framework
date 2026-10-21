import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { isWithinGracePeriod } from "../../shared/index.ts";
import { USER_STATUS, userTable } from "../../user/index.ts";
import { updateUserLifecycle } from "../lib/update-user-lifecycle.ts";

const APPEND_LIFECYCLE_EVENT_REASON =
  "appends the user lifecycle event on the SYSTEM_TENANT_ID user stream";

// POST /api/user/cancel-deletion.
//
// During the grace period, the user can withdraw a pending deletion request.
// This restores:
//   - status = "active"
//   - gracePeriodEnd = null
//
// After the grace period, return 422 because cleanup may already have triggered
// irreversible hooks.
//
// Cancelling as an "active" user also returns 422 because no deletion is pending.
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
    grants: ["unsafeRaw", "globalWrites"],
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

    await updateUserLifecycle(ctx.db.unsafeRaw(), event.user.id, {
      status: USER_STATUS.Active,
      gracePeriodEnd: null,
      // Closes the replay-after-cancel window — a still-TTL-valid email
      // token verified against the nulled requestId can no longer arm a second grace period.
      pendingDeletionRequestId: null,
    });

    // gracePeriodEnd=null in the response mirrors request-deletion's
    // ISO timestamp so the frontend can handle both endpoints uniformly.
    const gracePeriodEnd: string | null = null;
    return {
      isSuccess: true as const,
      data: {
        userId: event.user.id,
        status: USER_STATUS.Active,
        gracePeriodEnd,
      },
    };
  },
});

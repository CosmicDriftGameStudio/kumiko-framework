import { defineWriteHandler, type HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { isWithinGracePeriod } from "../../shared/index.ts";
import { USER_STATUS, userTable } from "../../user/index.ts";
import { deletionCancelAnchor } from "../deletion-token.ts";
import { updateUserLifecycle } from "../lib/update-user-lifecycle.ts";

const APPEND_LIFECYCLE_EVENT_REASON =
  "appends the user lifecycle event on the SYSTEM_TENANT_ID user stream";

export type CancelPendingDeletionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: UnprocessableError };

// Shared by the session path (cancel-deletion) and the token path
// (cancel-deletion-by-token) so both leave the user row in the same state.
// The calling handler must declare the escapeHatch for the lifecycle write.
export async function cancelPendingDeletion(
  ctx: HandlerContext,
  userId: string,
  cancelTokenAnchor?: string,
): Promise<CancelPendingDeletionResult> {
  const row = await ctx.db.global(userTable).fetchOne<{
    status: string;
    gracePeriodEnd: Temporal.Instant | null;
    version: number;
  }>({ id: userId });

  if (!row) {
    return { ok: false, error: new UnprocessableError("user_not_found", { details: { userId } }) };
  }

  if (row.status !== USER_STATUS.DeletionRequested) {
    return {
      ok: false,
      error: new UnprocessableError("no_pending_deletion", {
        details: { currentStatus: row.status },
      }),
    };
  }

  if (!isWithinGracePeriod(row.gracePeriodEnd)) {
    return { ok: false, error: new UnprocessableError("grace_period_expired") };
  }

  const isBoundToCancelToken = cancelTokenAnchor !== undefined;
  if (
    isBoundToCancelToken &&
    (row.gracePeriodEnd == null || deletionCancelAnchor(row.gracePeriodEnd) !== cancelTokenAnchor)
  ) {
    return {
      ok: false,
      error: new UnprocessableError("no_pending_deletion", {
        details: { currentStatus: row.status },
      }),
    };
  }

  const { applied } = await updateUserLifecycle(
    ctx.db.unsafeRawAllTenants(),
    userId,
    {
      status: USER_STATUS.Active,
      gracePeriodEnd: null,
      // Closes the replay-after-cancel window — a still-TTL-valid email
      // token verified against the nulled requestId can no longer arm a second grace period.
      pendingDeletionRequestId: null,
    },
    // Two concurrent cancels: only the one that still sees DeletionRequested wins. A cancel
    // token belongs to one deletion cycle, so its write also pins the row version the anchor
    // was checked on; a cancel plus a new request in between cannot be undone by the old link.
    {
      expect: {
        status: USER_STATUS.DeletionRequested,
        ...(isBoundToCancelToken && { version: row.version }),
      },
    },
  );
  if (!applied) {
    return {
      ok: false,
      error: new UnprocessableError("no_pending_deletion", {
        details: { currentStatus: USER_STATUS.Active },
      }),
    };
  }
  return { ok: true };
}

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
    grants: ["unsafeRaw"],
    reason: APPEND_LIFECYCLE_EVENT_REASON,
  },
  handler: async (event, ctx) => {
    const res = await cancelPendingDeletion(ctx, event.user.id);
    if (!res.ok) return writeFailure(res.error);

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

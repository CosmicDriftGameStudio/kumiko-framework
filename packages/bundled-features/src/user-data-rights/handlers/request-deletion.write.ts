import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { USER_STATUS } from "../../user/index.ts";
import {
  type DeletionRequestedMailOptions,
  resolveGracePeriod,
  sendDeletionRequestedNotification,
  startDeletionGracePeriod,
} from "./deletion-grace-period.ts";

// Sends a best-effort email after the deletion-requested status flip, following the
// password-reset callback pattern in auth-routes.ts. Send failures are caught and logged
// with console.warn so the status change remains successful: the user's action is complete
// once the database row is updated, while email delivery is confirmation rather than a
// prerequisite. This prevents users from having to click "Delete account" again when
// email delivery fails.
export type SendDeletionRequestedEmailFn = (args: {
  readonly userId: string;
  readonly userEmail: string;
  /** Stored user.locale (free-form) — lets the default mailer render in the
   *  recipient's language. */
  readonly userLocale: string | null;
  readonly tenantId: string;
  readonly gracePeriodEnd: string;
  /** Token link that cancels the deletion without signing in (a requested
   *  account cannot sign in). Set only when the feature has deletionCancelUrl
   *  and deletionTokenSecret. */
  readonly cancelUrl?: string;
}) => Promise<void>;

export type RequestDeletionOptions = DeletionRequestedMailOptions;

// POST /api/user/request-deletion — GDPR Art. 17 erasure request.
// Changes status=Active → deletionRequested and sets gracePeriodEnd from the compliance
// profile using the shared startDeletionGracePeriod logic. The operation applies to the
// account-wide user row, so the user identity is global across tenants.
export function createRequestDeletionHandler(opts: RequestDeletionOptions = {}) {
  return defineWriteHandler({
    name: "request-deletion",
    schema: z.object({}),
    access: {
      openToAll: {
        reason:
          "each signed-in user starts deletion of only their own account; the grace " +
          "period is armed for the caller's own userId",
      },
    },
    escapeHatch: {
      grants: ["systemIdentity", "unsafeRaw"],
      reason:
        "resolveGracePeriod reads the tenant compliance profile via ctx.dispatch.queryAs(SYSTEM, " +
        "...) to compute the grace period end — the calling user's own identity has no read " +
        "access to that tenant-config projection. startDeletionGracePeriod also appends the " +
        "user lifecycle event on the SYSTEM_TENANT_ID user stream.",
    },
    description:
      "Starts the GDPR Art. 17 deletion of the calling user's own account by arming the grace period from the tenant compliance profile and mailing a confirmation, after which only cancel-deletion can stop the erasure.",
    agent: { risk: "high" },
    handler: async (event, ctx) => {
      const res = await startDeletionGracePeriod(
        ctx,
        event.user.id,
        () => resolveGracePeriod(ctx, event.user.tenantId),
        ctx.db.unsafeRaw(),
      );
      if (!res.ok) return writeFailure(res.error);
      const { gracePeriodEnd, userEmail, userLocale } = res;

      await sendDeletionRequestedNotification(
        ctx,
        opts,
        {
          userId: event.user.id,
          userEmail,
          userLocale,
          tenantId: event.user.tenantId,
          gracePeriodEnd,
        },
        "request-deletion",
      );

      // Returns the absolute gracePeriodEnd timestamp so the frontend, audit, and cleanup
      // runner all use the same value.
      return {
        isSuccess: true as const,
        data: {
          userId: event.user.id,
          status: USER_STATUS.DeletionRequested,
          gracePeriodEnd: gracePeriodEnd.toString(),
        },
      };
    },
  });
}

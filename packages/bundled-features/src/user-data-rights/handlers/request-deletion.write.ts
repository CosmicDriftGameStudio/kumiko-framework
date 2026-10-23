import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { USER_STATUS } from "../../user/index.ts";
import {
  type GdprMailDefaults,
  isGdprMailDeliveryAvailable,
  makeDefaultDeletionRequestedEmail,
} from "../lib/default-mailers.ts";
import { resolveGracePeriod, startDeletionGracePeriod } from "./deletion-grace-period.ts";

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
}) => Promise<void>;

export type RequestDeletionOptions = {
  readonly sendDeletionRequestedEmail?: SendDeletionRequestedEmailFn;
  /** Branding for the default email when sendDeletionRequestedEmail is not set
   *  and mail-foundation is mounted. */
  readonly mailDefaults?: GdprMailDefaults;
};

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

      // The app callback wins; otherwise the default mail goes through ctx.notify after
      // the commit. Without delivery and an email channel there is no sender and no mail.
      const send =
        opts.sendDeletionRequestedEmail ??
        (ctx.notify !== undefined && isGdprMailDeliveryAvailable(ctx.registry)
          ? makeDefaultDeletionRequestedEmail(ctx.notify, opts.mailDefaults)
          : undefined);

      // Best-effort email notification: a send failure must not abort the write.
      if (send && userEmail.length > 0) {
        try {
          await send({
            userId: event.user.id,
            userEmail,
            userLocale,
            tenantId: event.user.tenantId,
            gracePeriodEnd: gracePeriodEnd.toString(),
          });
        } catch (err) {
          // biome-ignore lint/suspicious/noConsole: operator-visibility for email-send-failure
          console.warn(
            `[user-data-rights:request-deletion] sendDeletionRequestedEmail failed userId=${event.user.id} tenantId=${event.user.tenantId} err=${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

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
